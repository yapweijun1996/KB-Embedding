# Task: Create KB Preprocessing Workflow (Embedding Script)

## Status
- [x] Create embedding script `scripts/embed_jsonl.js` <!-- id: 0 -->
- [x] Verify script with a test run (dry run or actual) <!-- id: 1 -->
- [x] Create batch processing script `scripts/batch_embed.sh` <!-- id: 3 -->
- [x] Create React + Vite UI for easy user interaction <!-- id: 4 -->
- [x] Improve UI/UX with premium design <!-- id: 5 -->
- [x] Implement specific embedding logic (Qwen3, Batching, Priority) <!-- id: 6 -->
- [x] Document usage for the user <!-- id: 2 -->

## Details
The goal is to convert `knowledge.jsonl` (text only) to `knowledge.embedded.jsonl` (with embeddings) to speed up frontend loading.
Script will:
1. Read JSONL line by line.
2. Call Embedding API (POST /v1/embeddings).
3. Write output with `embedding` field.

## LM Studio Setup
- The default embedding endpoint is now `http://192.168.1.236:9989/v1/embeddings` (LM Studio local server).
- Default model name is `Qwen3-Embedding-4B-GGUF`; update the Settings drawer or `EMBEDDING_*` env vars to override when needed.
