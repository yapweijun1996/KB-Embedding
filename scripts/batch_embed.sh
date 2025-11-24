#!/bin/bash

# Configuration
INPUT_DIR="jsonl"
OUTPUT_SUFFIX=".embedded.jsonl"
SCRIPT="scripts/embed_jsonl.js"

# Check if node script exists
if [ ! -f "$SCRIPT" ]; then
    echo "❌ Error: Embedding script not found at $SCRIPT"
    exit 1
fi

echo "🚀 Starting Batch Embedding..."
echo "========================================"

# Loop through all .jsonl files in the input directory
for file in "$INPUT_DIR"/*.jsonl; do
    # Skip if it's already an embedded file (prevent recursion)
    if [[ "$file" == *"$OUTPUT_SUFFIX" ]]; then
        continue
    fi

    # Construct output filename
    # e.g., data.jsonl -> data.embedded.jsonl
    filename=$(basename "$file" .jsonl)
    output_file="$INPUT_DIR/${filename}${OUTPUT_SUFFIX}"

    echo "Processing: $file"
    echo "   -> Output: $output_file"

    # Run the embedding script
    node "$SCRIPT" "$file" "$output_file"
    
    # Check exit code
    if [ $? -eq 0 ]; then
        echo "✅ Done: $filename"
    else
        echo "❌ Failed: $filename"
    fi
    echo "----------------------------------------"
done

echo "🎉 Batch processing complete!"
