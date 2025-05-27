#!/bin/bash

# RogueLLM Environment Setup Script
echo "🎮 RogueLLM Environment Setup"
echo "=============================="
echo

# Check if .env file exists
if [ -f ".env" ]; then
    echo "✅ .env file already exists"
    echo "   You can edit it manually or delete it to recreate"
    echo
    read -p "Do you want to recreate the .env file? (y/N): " recreate
    if [[ ! $recreate =~ ^[Yy]$ ]]; then
        echo "Keeping existing .env file"
        exit 0
    fi
    echo "Recreating .env file..."
    rm .env
fi

# Create .env file from template
echo "📝 Creating .env file..."
cat > .env << 'EOF'
# Session Security
# Generate a secure random string for session encryption
# You can generate one with: python -c "import secrets; print(secrets.token_urlsafe(32))"
SESSION_SECRET_KEY=your_secure_random_session_key_here

# OpenAI API Configuration
# Get your API key from: https://platform.openai.com/api-keys

# For OpenAI models (default configuration)
LOW_SPEC_MODEL_NAME=gpt-4.1-mini
HIGH_SPEC_MODEL_NAME=gpt-4.1-mini
LOW_SPEC_MODEL_API_KEY=your_openai_api_key_here
HIGH_SPEC_MODEL_API_KEY=your_openai_api_key_here

# Alternative: Use different models for low and high spec
# LOW_SPEC_MODEL_NAME=gpt-4o-mini
# HIGH_SPEC_MODEL_NAME=gpt-4.1

# For custom OpenAI-compatible endpoints (optional)
# LOW_SPEC_MODEL_BASE_URL=https://api.openai.com/v1
# HIGH_SPEC_MODEL_BASE_URL=https://api.openai.com/v1

# Search Provider Configuration (optional)
# Possible providers: duckduckgo, serpapi
SEARCH_PROVIDER=duckduckgo
# SerpApi key if using SerpApi provider (optional)
# SERPAPI_KEY=your_serpapi_key_here

# Firebase Configuration (Optional)
# FIREBASE_API_KEY=
# FIREBASE_AUTH_DOMAIN=
# FIREBASE_PROJECT_ID=
# FIREBASE_STORAGE_BUCKET=
# FIREBASE_MESSAGING_SENDER_ID=
# FIREBASE_APP_ID=
# FIREBASE_MEASUREMENT_ID=
EOF

echo "✅ .env file created successfully!"
echo
echo "🔑 NEXT STEPS:"
echo "1. Get your OpenAI API key from: https://platform.openai.com/api-keys"
echo "2. Edit the .env file and replace:"
echo "   - 'your_openai_api_key_here' with your actual API key"
echo "   - 'your_secure_random_session_key_here' with a secure random string"
echo "3. You can use the same API key for both LOW_SPEC_MODEL_API_KEY and HIGH_SPEC_MODEL_API_KEY"
echo "4. Generate a session key with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
echo
echo "📝 To edit the .env file:"
echo "   nano .env"
echo "   # or"
echo "   code .env"
echo
echo "🚀 After setting up your API key, run:"
echo "   ./run.sh"
echo

# Check if user wants to open the file for editing
read -p "Do you want to open the .env file for editing now? (y/N): " edit_now
if [[ $edit_now =~ ^[Yy]$ ]]; then
    if command -v code &> /dev/null; then
        echo "Opening .env in VS Code..."
        code .env
    elif command -v nano &> /dev/null; then
        echo "Opening .env in nano..."
        nano .env
    else
        echo "Please edit .env manually with your preferred text editor"
    fi
fi

echo
echo "🎮 Setup complete! Don't forget to add your API key to the .env file." 