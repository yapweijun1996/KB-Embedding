import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = true;

const cachedPipelines = new Map();

async function loadPipeline(modelId) {
  if (!cachedPipelines.has(modelId)) {
    cachedPipelines.set(
      modelId,
      pipeline('feature-extraction', modelId, { quantized: true })
    );
  }
  return cachedPipelines.get(modelId);
}

export async function embedTextsLocally(texts, modelId) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const extractor = await loadPipeline(modelId);
  const embeddings = [];

  for (const text of texts) {
    const cleanText = text.replace(/\s+/g, ' ').trim();
    const output = await extractor(cleanText, { pooling: 'mean', normalize: true });
    embeddings.push(Array.from(output.data));
  }

  return embeddings;
}
