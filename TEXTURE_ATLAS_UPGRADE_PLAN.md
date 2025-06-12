# Texture Atlas System Upgrade Plan

## Executive Summary

This document outlines the transition from Font Awesome icon-based textures to AI-generated texture atlases for the 3D version of RogueLLM. The goal is to create immersive, theme-consistent textures that enhance the visual experience while maintaining performance and modularity.

## Current State Analysis

### Current Texture System
- **Location**: `static/js/threejs/TextureManager.js`
- **Method**: Canvas-based Font Awesome icon rendering with solid background colors
- **Limitations**:
  - Icons designed for 2D interfaces, not 3D textures
  - Limited visual variety and depth
  - Inconsistent theme coherence
  - Poor scalability and visual quality at different distances

### Current Architecture
```
TextureManager
├── createIconTexture() - Renders FA icons on canvas
├── createFloorTexture() - Combines icon + background color
├── createSolidColorTexture() - Fallback solid colors
└── Cache system - In-memory texture caching
```

## Proposed Solution Architecture

### Phase 1: Texture Atlas Infrastructure

#### 1.1 Texture Atlas Data Model
```sql
-- New database tables
CREATE TABLE texture_atlases (
    id TEXT PRIMARY KEY,
    generator_id TEXT NOT NULL,
    theme_hash TEXT NOT NULL,
    atlas_size INTEGER DEFAULT 512,
    grid_size INTEGER DEFAULT 4,
    storage_url TEXT,
    local_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (generator_id) REFERENCES generators (id)
);

CREATE TABLE texture_atlas_cells (
    id TEXT PRIMARY KEY,
    atlas_id TEXT NOT NULL,
    cell_type TEXT NOT NULL,
    grid_x INTEGER NOT NULL,
    grid_y INTEGER NOT NULL,
    uv_x REAL NOT NULL,
    uv_y REAL NOT NULL,
    uv_width REAL NOT NULL,
    uv_height REAL NOT NULL,
    FOREIGN KEY (atlas_id) REFERENCES texture_atlases (id)
);
```

#### 1.2 Enhanced Data Models
```python
# models.py additions
class TextureAtlas(BaseModel):
    id: str
    generator_id: str
    theme_hash: str
    atlas_size: int = 512
    grid_size: int = 4
    storage_url: Optional[str] = None
    local_path: Optional[str] = None
    cells: Dict[str, TextureAtlasCell] = {}

class TextureAtlasCell(BaseModel):
    cell_type: str
    grid_x: int
    grid_y: int
    uv_coords: Tuple[float, float, float, float]  # x, y, width, height (0-1 range)
```

### Phase 2: Storage Integration

#### 2.1 Flexible Storage System
- **Development**: Local filesystem storage (`_data/textures/` directory)
- **Production**: Optional S3-compatible storage (DigitalOcean Spaces)
- **Configuration**: Environment variable `USE_S3_STORAGE=true/false`
- **Path Structure**:
  - Local: `_data/textures/{generator_id}/{atlas_id}.png`
  - S3: `textures/{generator_id}/{atlas_id}.png`

#### 2.2 Texture Storage Manager
```python
# New: texture_storage_manager.py
class TextureStorageManager:
    def __init__(self, use_s3: bool = False):
        self.use_s3 = use_s3  # Default False, S3 implementation TBD
        self.local_base_path = "_data/textures"
        self.ensure_local_directory(self.local_base_path)

    async def store_atlas(self, atlas_id: str, image_data: bytes) -> str:
        """Store atlas locally (S3 implementation placeholder)"""

    async def retrieve_atlas(self, atlas_id: str) -> bytes:
        """Retrieve from local storage (S3 fallback TBD)"""

    async def get_atlas_url(self, atlas_id: str) -> str:
        """Get local file path or S3 URL"""

    def cleanup_old_atlases(self, older_than_days: int = 30):
        """Clean up old local files (S3 cleanup TBD)"""

    def ensure_local_directory(self, path: str):
        """Create local directory structure"""
```

### Phase 3: AI Image Generation Integration

#### 3.1 Image Generation Service
```python
# New: texture_generator.py
class TextureGenerator:
    def __init__(self, gen_ai: GenAI = None):
        self.gen_ai = gen_ai  # Optional for placeholder mode

    async def generate_texture_atlas(
        self,
        theme_description: str,
        cell_types: List[CellType],
        atlas_size: int = 1024,
        grid_size: int = 4,
        use_ai: bool = False
    ) -> TextureAtlas:
        """Generate atlas with fallback hierarchy"""

    def generate_placeholder_atlas(
        self,
        cell_types: List[CellType],
        atlas_size: int = 1024,
        grid_size: int = 4
    ) -> bytes:
        """Generate simple color-based atlas using PIL"""

    def generate_enhanced_procedural_atlas(
        self,
        theme_description: str,
        cell_types: List[CellType],
        atlas_size: int = 1024,
        grid_size: int = 4
    ) -> bytes:
        """Generate enhanced procedural textures (gradients, patterns)"""
```

#### 3.2 Generation Strategy (Layered Approach)

##### 3.2.1 **Phase 1: Placeholder Textures (Minimum Runnable)**
- **Procedural Color Atlas**: Generate solid color rectangles based on cell type colors
- **Implementation**: Use PIL/Pillow to create 1024x1024 atlas with 4x4 grid
- **Source**: Use existing `map_color` from `game_celltypes.json`
- **Benefits**: Immediate functionality, no external API dependencies, zero cost

##### 3.2.2 **Phase 2: AI Generation (Enhancement)**
- **Model Choice**: FLUX.1 Pro for superior quality and performance
  - **FLUX.1 [dev]**: $0.025/image (development/testing)
  - **FLUX1.1 [pro]**: $0.04/image (production quality)
  - **Advantages**: 6x faster than competitors, better prompt adherence, up to 2K resolution
- **Prompt Engineering**:
  ```
  "Create a {atlas_size}x{atlas_size} pixel texture atlas with a {grid_size}x{grid_size} grid of seamless game terrain textures for a {theme_description} themed roguelike game. Each cell should contain: [list of cell types]. Style: top-down view, seamless tiling, consistent lighting, game-ready textures, realistic materials."
  ```
- **Alternative Models**: DALL-E 3 (1024x1024), Leonardo AI, Adobe Firefly as fallbacks

##### 3.2.3 **Fallback Hierarchy**
1. **AI-Generated Atlas** (Best quality, requires API)
2. **Enhanced Procedural** (Gradients, patterns, noise)
3. **Simple Color Atlas** (Solid colors, always works)

#### 3.3 Generation Workflow (Updated)
```
1. Hash theme + cell_types to check for existing atlas
2. If not cached, determine generation method:
   a. AI Generation (if use_ai=True and gen_ai available)
      - Generate prompt from theme + cell_types
      - Call FLUX.1 API with 1024x1024 size
      - Post-process: crop to perfect grid, enhance contrast
   b. Placeholder Generation (default)
      - Use PIL to create color grid from cell_types[].map_color
      - Generate 1024x1024 with 4x4 grid of solid colors
3. Store locally (S3 implementation TBD)
4. Create UV mapping data for each cell type
5. Update database with atlas metadata
```

### Phase 4: Client-Side Texture Atlas System

#### 4.1 Enhanced TextureManager
```javascript
// Updated TextureManager.js
class TextureManager {
    constructor() {
        this.atlasCache = new Map();
        this.uvMappings = new Map();
    }

    async loadTextureAtlas(atlasId) {
        // Load atlas texture and UV mappings
    }

    createAtlasTexture(cellType, atlasId) {
        // Create texture using UV coordinates from atlas
    }

    createFallbackTexture(cellType) {
        // Enhanced fallback using procedural generation
    }
}
```

#### 4.2 Three.js Atlas Integration
- **Texture Loading**: Async loading of atlas textures
- **UV Mapping**: Apply correct UV coordinates for each cell type
- **Shader Enhancement**: Support for atlas-based texture sampling
- **Fallback System**: Graceful degradation to current system

### Phase 5: Implementation Phases (Revised)

#### Phase 5.1: Minimum Runnable Foundation (Week 1) ✅ **COMPLETED**
- [x] Create database schema for texture atlases
- [x] Implement TextureAtlas and related data models
- [x] Create TextureStorageManager (local storage only)
- [x] Implement TextureGenerator with placeholder atlas generation (PIL/colors)
- [x] Basic texture atlas API endpoints

#### Phase 5.2: Client Integration (Week 2) ✅ **COMPLETED**
- [x] Update TextureManager for atlas support
- [x] Modify MapRenderer to use atlas textures with UV mapping
- [x] Implement fallback to current Font Awesome system
- [x] Test basic atlas functionality with placeholder textures

#### Phase 5.3: Enhanced Procedural (Week 3)
- [ ] Implement enhanced procedural texture generation
- [ ] Add gradients, patterns, and noise to placeholder textures
- [ ] Improve visual quality without AI dependency
- [ ] Performance optimization and caching

#### Phase 5.4: AI Integration (Week 4-5)
- [ ] Add FLUX.1 API integration to gen_ai.py (optional feature)
- [ ] Create texture generation prompts optimized for FLUX.1
- [ ] Implement AI generation toggle in configuration
- [ ] Add S3 storage implementation for production deployment

#### Phase 5.5: Polish & Production (Week 5-6)
- [ ] Add texture generation queue system
- [ ] Create admin interface for texture management
- [ ] Comprehensive testing and bug fixes
- [ ] Documentation and deployment guides

## Technical Considerations

### Performance
- **Memory Usage**: Atlas textures more memory-efficient than individual textures
- **Loading Time**: Single atlas load vs multiple individual textures
- **Caching**: Local browser cache + S3 CDN for fast access
- **Compression**: WebP format with PNG fallback

### Scalability
- **Theme Variations**: Each theme gets unique atlas
- **Generator Sharing**: Same theme = same atlas across generators
- **Storage Growth**: Implement cleanup policies for old atlases
- **Rate Limiting**: AI generation throttling and queuing

### Fallback Strategy
1. **AI-Generated Atlas** (Primary)
2. **Procedural Textures** (If AI fails)
3. **Enhanced Font Awesome** (Current system as last resort)

### Quality Assurance
- **Theme Consistency**: Validate atlas matches theme description
- **Visual Coherence**: Ensure adjacent tiles blend well
- **Performance Testing**: Monitor memory usage and loading times
- **A/B Testing**: Compare visual quality with current system

## Migration Strategy

### Backward Compatibility
- Keep current TextureManager as fallback
- Gradual rollout with feature flags
- Support for both systems during transition

### Data Migration
- No existing data migration needed (additive changes)
- Existing games continue with current texture system
- New games automatically use atlas system when available

### Rollout Plan
1. **Internal Testing**: Deploy to development environment
2. **Beta Feature**: Limited user testing with opt-in
3. **Gradual Rollout**: Percentage-based rollout
4. **Full Deployment**: Complete migration after validation

## Cost Considerations

### AI Generation Costs
- **FLUX.1 [dev]**: $0.025 per 1024x1024 image (development)
- **FLUX1.1 [pro]**: $0.04 per 1024x1024 image (production)
- **Expected Usage**: 1 atlas per unique theme (~16 cell types)
- **Caching**: Significant cost savings through atlas reuse
- **Budget Impact**: Minimal - most themes generated once, ~$0.04 per unique theme

### Storage Costs
- **Local Development**: Free (filesystem storage)
- **Production S3**: Optional - only if using cloud storage
  - **Size**: ~1-2MB per atlas (1024x1024 compressed)
  - **DigitalOcean Spaces**: $5/month for 250GB
  - **Growth**: Sustainable with cleanup policies

## Success Metrics

### Visual Quality
- User feedback on visual improvements
- Comparison screenshots: before vs after
- Theme coherence evaluation

### Performance
- Texture loading time reduction
- Memory usage optimization
- Frame rate stability

### Technical
- Atlas cache hit rate (target: >80%)
- AI generation success rate (target: >95%)
- Storage cost per active user
- Fallback system usage rate (target: <5%)

## Risk Mitigation

### Technical Risks
- **AI API Failures**: Robust fallback system
- **Storage Issues**: Local caching + retry logic
- **Performance Impact**: Comprehensive testing
- **Browser Compatibility**: Progressive enhancement

### Business Risks
- **Cost Overrun**: Usage monitoring and limits
- **Quality Issues**: Human review process for generated textures
- **User Adoption**: Gradual rollout with feedback loops

## Implementation Status Update

### ✅ **Completed: Phase 5.1 & 5.2 (Minimum Runnable Foundation)**

**Implementation Date**: June 2025

#### **Successfully Implemented**
1. **Backend Infrastructure**:
   - ✅ `TextureAtlas` and `TextureAtlasCell` Pydantic models in `models.py`
   - ✅ Database schema with `texture_atlases` and `texture_atlas_cells` tables
   - ✅ `TextureStorageManager` with local filesystem storage (`_data/textures/`)
   - ✅ `TextureGenerator` with PIL-based placeholder atlas generation
   - ✅ FastAPI endpoints: `/api/textures/generate`, `/api/textures/{atlas_id}`, `/api/textures/{atlas_id}/image`

2. **Frontend Integration**:
   - ✅ Enhanced `TextureManager.js` with atlas loading, UV mapping, and caching
   - ✅ Updated `MapRenderer.js` to use atlas textures with automatic initialization
   - ✅ Robust fallback system to Font Awesome when atlas fails
   - ✅ Async atlas generation and loading

3. **Testing & Validation**:
   - ✅ Database initialization working
   - ✅ Atlas generation producing 1024x1024 PNG files with color-coded cells
   - ✅ API endpoints responding correctly
   - ✅ Local storage working in `_data/textures/{generator_id}/` structure
   - ✅ UV coordinate calculation and mapping functional

#### **Current Capabilities**
- **Placeholder Textures**: Generates vibrant, multi-colored atlases using a deterministic hashing function on cell names. This ensures every cell has a unique, visually distinct color, providing richer feedback than the previous `map_color`-based system.
- **Local Storage**: All atlases stored and retrieved from local filesystem
- **Database Persistence**: Atlas metadata and UV mappings stored in SQLite
- **API Integration**: Full REST API for texture management
- **Fallback System**: Graceful degradation to Font Awesome if needed
- **Performance**: Efficient caching at both database and browser levels

#### **Recent Enhancements & Fixes (June 2025)**
- **Render Pipeline Fixed**: Addressed a series of critical frontend bugs that resulted in a blank screen. This included fixing JavaScript syntax errors (`MapRenderer.js`, `TextureManager.js`) and resolving an asynchronous race condition in the rendering logic (`threejs-renderer.js`).
- **Enhanced Placeholder Atlas**: Upgraded the `texture_generator.py` to produce more visually diverse and informative placeholder atlases. The previous version produced all-white textures in some cases. The new system generates a unique, vibrant, and deterministic color for every cell in the grid, ensuring the entire map is textured and visually debuggable.

#### **Example Output**
```bash
# Successful test run:
Generated atlas: atlas_test_gen_01_1dcd5c36fc8b9729
Atlas has 5 cells
Atlas stored at: _data/textures/test_gen_01/atlas_test_gen_01_1dcd5c36fc8b9729.png
Retrieved image data: 4657 bytes
```

### 🚀 **Ready for Next Phase**

The system is now **fully functional** and ready for:
1. **Phase 5.3**: Enhanced procedural textures (gradients, patterns)
2. **Phase 5.4**: AI integration with FLUX.1
3. **Phase 5.5**: Production polish and S3 storage

### 📁 **Key Files Created/Modified**
- `models.py` - Added TextureAtlas models
- `db.py` - Added atlas tables and management methods
- `texture_storage_manager.py` - **NEW** Local storage management
- `texture_generator.py` - **NEW** Atlas generation with PIL
- `main.py` - Added texture API endpoints
- `static/js/threejs/TextureManager.js` - Enhanced with atlas support
- `static/js/threejs/MapRenderer.js` - Updated to use atlases

## Conclusion

This texture atlas upgrade represents a significant enhancement to RogueLLM's visual experience. **Phase 5.1 and 5.2 are now complete and functional**, providing immediate visual improvements through color-coded texture atlases instead of Font Awesome icons.

The foundation is solid and ready for the next phases of enhanced procedural generation and AI integration. The system maintains robust fallback capabilities and optimal performance while opening the door for future visual enhancements.