import os
import aiofiles
import logging
from typing import Optional
from pathlib import Path

logger = logging.getLogger(__name__)


class TextureStorageManager:
    def __init__(self, use_s3: bool = False):
        self.use_s3 = use_s3  # Default False, S3 implementation TBD
        self.local_base_path = "_data/textures"
        self.ensure_local_directory(self.local_base_path)

    def ensure_local_directory(self, path: str):
        """Create local directory structure"""
        try:
            os.makedirs(path, exist_ok=True)
            logger.debug(f"Ensured directory exists: {path}")
        except Exception as e:
            logger.error(f"Failed to create directory {path}: {e}")
            raise

    def get_local_path(self, generator_id: str, atlas_id: str) -> str:
        """Get local file path for atlas"""
        generator_dir = os.path.join(self.local_base_path, generator_id)
        self.ensure_local_directory(generator_dir)
        return os.path.join(generator_dir, f"{atlas_id}.png")

    async def store_atlas(self, generator_id: str, atlas_id: str, image_data: bytes) -> str:
        """Store atlas locally (S3 implementation placeholder)"""
        try:
            if self.use_s3:
                # TODO: Implement S3 storage
                logger.warning("S3 storage not yet implemented, falling back to local storage")

            # Store locally
            local_path = self.get_local_path(generator_id, atlas_id)

            async with aiofiles.open(local_path, 'wb') as f:
                await f.write(image_data)

            logger.info(f"Stored atlas {atlas_id} locally at {local_path}")
            return local_path

        except Exception as e:
            logger.error(f"Failed to store atlas {atlas_id}: {e}")
            raise

    async def retrieve_atlas(self, generator_id: str, atlas_id: str) -> Optional[bytes]:
        """Retrieve from local storage (S3 fallback TBD)"""
        try:
            local_path = self.get_local_path(generator_id, atlas_id)

            if os.path.exists(local_path):
                async with aiofiles.open(local_path, 'rb') as f:
                    data = await f.read()
                logger.debug(f"Retrieved atlas {atlas_id} from local storage")
                return data

            if self.use_s3:
                # TODO: Implement S3 retrieval fallback
                logger.warning("S3 retrieval not yet implemented")

            logger.warning(f"Atlas {atlas_id} not found in local storage")
            return None

        except Exception as e:
            logger.error(f"Failed to retrieve atlas {atlas_id}: {e}")
            return None

    def get_atlas_url(self, generator_id: str, atlas_id: str) -> str:
        """Get local file path or S3 URL"""
        if self.use_s3:
            # TODO: Return S3 URL when implemented
            logger.warning("S3 URLs not yet implemented, returning local path")

        return self.get_local_path(generator_id, atlas_id)

    def atlas_exists(self, generator_id: str, atlas_id: str) -> bool:
        """Check if atlas exists in storage"""
        local_path = self.get_local_path(generator_id, atlas_id)
        return os.path.exists(local_path)

    def cleanup_old_atlases(self, older_than_days: int = 30):
        """Clean up old local files (S3 cleanup TBD)"""
        # TODO: Implement cleanup logic based on file age
        logger.info(f"Cleanup for files older than {older_than_days} days not yet implemented")

    def get_atlas_size_on_disk(self, generator_id: str, atlas_id: str) -> Optional[int]:
        """Get atlas file size in bytes"""
        local_path = self.get_local_path(generator_id, atlas_id)
        try:
            return os.path.getsize(local_path) if os.path.exists(local_path) else None
        except Exception as e:
            logger.error(f"Failed to get size for atlas {atlas_id}: {e}")
            return None