const fs = require('fs');
const readline = require('readline');
const path = require('path');

// --- CONFIGURATION ---
// You can override these with environment variables
const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || 'transformers').toLowerCase();
const API_URL = process.env.EMBEDDING_API_URL || 'http://192.168.1.236:9989/v1/embeddings';
const MODEL_NAME = process.env.EMBEDDING_MODEL || 'Qwen3-Embedding-4B-GGUF';
const TRANSFORMER_MODEL = process.env.TRANSFORMER_MODEL || 'Xenova/all-MiniLM-L6-v2';
const CONCURRENCY = 1; // Keep 1 for sequential processing to avoid overwhelming local LLMs

// --- PATHS ---
const DEFAULT_INPUT = path.join(__dirname, '../jsonl/knowledge.jsonl');
const DEFAULT_OUTPUT = path.join(__dirname, '../jsonl/knowledge.embedded.jsonl');

const getEmbeddingText = (record) => {
    if (!record || typeof record !== 'object') return '';
    if (record.dense_context) return record.dense_context;
    if (record.question && record.answer) {
        return `Q: ${record.question}\nA: ${record.answer}`;
    }
    return record.text || '';
};

const inputFile = process.argv[2] || DEFAULT_INPUT;
const outputFile = process.argv[3] || DEFAULT_OUTPUT;

// --- MAIN ---
(async () => {
    console.log(`\n🚀 Starting Embedding Pre-processing`);
    console.log(`========================================`);
    console.log(`📂 Input:   ${inputFile}`);
    console.log(`📂 Output:  ${outputFile}`);
    console.log(`⚙️  Mode:    ${EMBEDDING_PROVIDER === 'transformers' ? 'MiniLM (local @xenova/transformers)' : 'Remote API'}`);
    if (EMBEDDING_PROVIDER === 'transformers') {
        console.log(`🧠 Model:   ${TRANSFORMER_MODEL}`);
    } else {
        console.log(`🔌 API:     ${API_URL}`);
        console.log(`🧠 Model:   ${MODEL_NAME}`);
    }
    console.log(`========================================\n`);

    if (!fs.existsSync(inputFile)) {
        console.error(`❌ Error: Input file not found at ${inputFile}`);
        console.log(`\nUsage: node scripts/embed_jsonl.js <input_path> <output_path>`);
        console.log(`Example: node scripts/embed_jsonl.js jsonl/my_data.jsonl jsonl/my_data_embedded.jsonl`);
        process.exit(1);
    }

    const outputStream = fs.createWriteStream(outputFile, { flags: 'w' });
    const fileStream = fs.createReadStream(inputFile);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let processedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    let startTime = Date.now();

    console.log(`Processing...`);

    for await (const line of rl) {
        if (!line.trim()) continue;

        try {
            const record = JSON.parse(line);
            
            const textToEmbed = getEmbeddingText(record);
            if (!textToEmbed) {
                skippedCount++;
                outputStream.write(JSON.stringify(record) + '\n');
                continue;
            }

            // Skip if already embedded (optional, but good for resuming)
            if (record.embedding && Array.isArray(record.embedding) && record.embedding.length > 0) {
                outputStream.write(JSON.stringify(record) + '\n');
                processedCount++;
                process.stdout.write(`\r✅ Processed: ${processedCount} (Already embedded)`);
                continue;
            }

            // Get embedding
            const embedding = await fetchEmbedding(textToEmbed);
            
            if (embedding) {
                record.embedding = embedding;
                outputStream.write(JSON.stringify(record) + '\n');
                processedCount++;
                
                if (processedCount % 5 === 0) {
                    process.stdout.write(`\r✅ Processed: ${processedCount} records...`);
                }
            } else {
                errorCount++;
                // Optionally write the failed record without embedding or log it
                console.error(`\nFailed to embed record: ${record.id}`);
            }

        } catch (err) {
            console.error(`\n❌ Error processing line: ${err.message}`);
            errorCount++;
        }
    }

    outputStream.end();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n\n🎉 Finished!`);
    console.log(`⏱️  Time taken: ${duration}s`);
    console.log(`✅ Success: ${processedCount}`);
    console.log(`⏭️  Skipped: ${skippedCount}`);
    console.log(`❌ Failed:  ${errorCount}`);
    console.log(`📄 Saved to: ${outputFile}`);
})();

let transformerPipelinePromise = null;

async function getTransformerPipeline() {
    if (!transformerPipelinePromise) {
        transformerPipelinePromise = (async () => {
            const { pipeline, env } = await import('@xenova/transformers');
            env.allowLocalModels = true;
            console.log(`\n⏬ Loading ${TRANSFORMER_MODEL} via @xenova/transformers...`);
            const extractor = await pipeline('feature-extraction', TRANSFORMER_MODEL, {
                quantized: true
            });
            console.log(`✅ Loaded ${TRANSFORMER_MODEL}\n`);
            return extractor;
        })();
    }
    return transformerPipelinePromise;
}

async function fetchEmbedding(text) {
    try {
        if (EMBEDDING_PROVIDER === 'transformers') {
            return await fetchEmbeddingWithTransformers(text);
        }
        return await fetchEmbeddingViaApi(text);
    } catch (error) {
        console.error(`\n❌ Embedding request failed: ${error.message}`);
        return null;
    }
}

async function fetchEmbeddingWithTransformers(text) {
    const extractor = await getTransformerPipeline();
    const cleanText = text.replace(/\s+/g, ' ').trim();
    const output = await extractor(cleanText, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

async function fetchEmbeddingViaApi(text) {
    const cleanText = text.replace(/\n/g, ' ');

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: MODEL_NAME,
            input: cleanText
        })
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`API Error: ${response.status} ${body}`);
    }

    const data = await response.json();

    if (data.data && data.data[0] && data.data[0].embedding) {
        return data.data[0].embedding;
    }

    if (Array.isArray(data)) {
        return data;
    }

    throw new Error('Unexpected response format');
}
