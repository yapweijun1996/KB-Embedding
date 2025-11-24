import { useState, useRef } from 'react';
import { Upload, FileJson, Play, Download, Settings, Loader2, X, Trash2, Database, CheckCircle2 } from 'lucide-react';
import './App.css';

const DEFAULT_API_URL = 'http://192.168.1.236:9989/v1/embeddings';
const DEFAULT_MODEL = 'Qwen3-Embedding-4B-GGUF';
const BATCH_SIZE = 8;

function App() {
  const [files, setFiles] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [config, setConfig] = useState({
    apiUrl: DEFAULT_API_URL,
    model: DEFAULT_MODEL
  });
  const [showConfig, setShowConfig] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = (e) => {
    if (!e.target.files.length) return;
    addFiles(e.target.files);
    e.target.value = '';
  };

  const addFiles = (fileList) => {
    const newFiles = Array.from(fileList).map(file => ({
      file,
      id: Math.random().toString(36).substr(2, 9),
      status: 'pending',
      progress: 0,
      total: 0,
      processed: 0,
      resultUrl: null,
      error: null
    }));
    setFiles(prev => [...prev, ...newFiles]);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const removeFile = (id) => {
    if (isProcessing) return;
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearAll = () => {
    if (isProcessing) return;
    setFiles([]);
  };

  const getEmbeddingText = (record) => {
    if (record.dense_context) return record.dense_context;
    if (record.question && record.answer) return `Q: ${record.question}\nA: ${record.answer}`;
    return record.text || "";
  };

  async function* lineIterator(file) {
    const stream = file.stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let { value: chunk, done: readerDone } = await reader.read();
    let buffer = '';

    while (!readerDone || buffer) {
      if (chunk) {
        buffer += decoder.decode(chunk, { stream: true });
      }

      const lines = buffer.split('\n');
      buffer = readerDone ? '' : lines.pop();

      for (const line of lines) {
        if (line.trim()) yield line;
      }

      if (readerDone) break;
      ({ value: chunk, done: readerDone } = await reader.read());
    }
  }

  const processFile = async (fileItem) => {
    try {
      updateFileStatus(fileItem.id, { status: 'processing', progress: 0 });

      const totalSize = fileItem.file.size;
      let processedBytes = 0;
      const processedLines = [];
      let batch = [];
      let batchRecords = [];
      const iterator = lineIterator(fileItem.file);
      let processedCount = 0;

      for await (const line of iterator) {
        processedBytes += new TextEncoder().encode(line + '\n').length;

        try {
          const record = JSON.parse(line);
          const textToEmbed = getEmbeddingText(record);

          if (record.embedding && Array.isArray(record.embedding) && record.embedding.length > 0) {
            processedLines.push(JSON.stringify(record));
            processedCount++;
          } else if (!textToEmbed) {
            processedLines.push(line);
            processedCount++;
          } else {
            batch.push(textToEmbed);
            batchRecords.push(record);
          }

          if (batch.length >= BATCH_SIZE) {
            await processBatch(batch, batchRecords, processedLines, config);
            processedCount += batch.length;
            batch = [];
            batchRecords = [];

            updateFileStatus(fileItem.id, {
              processed: processedCount,
              progress: Math.min(99, Math.round((processedBytes / totalSize) * 100))
            });

            await new Promise(resolve => setTimeout(resolve, 0));
          }

        } catch (e) {
          console.error('Error parsing line', e);
          processedLines.push(line);
        }
      }

      if (batch.length > 0) {
        await processBatch(batch, batchRecords, processedLines, config);
        processedCount += batch.length;
      }

      const blob = new Blob([processedLines.join('\n')], { type: 'application/jsonl' });
      const url = URL.createObjectURL(blob);

      updateFileStatus(fileItem.id, {
        status: 'done',
        progress: 100,
        processed: processedCount,
        total: processedCount,
        resultUrl: url
      });

    } catch (err) {
      console.error(err);
      updateFileStatus(fileItem.id, { status: 'error', error: err.message });
    }
  };

  const processBatch = async (texts, records, outputBuffer, config) => {
    const embeddings = await fetchBatchEmbeddings(texts, config);

    if (!embeddings || embeddings.length !== records.length) {
      throw new Error('Embedding service returned an unexpected payload');
    }

    records.forEach((record, index) => {
      record.embedding = embeddings[index];
      outputBuffer.push(JSON.stringify(record));
    });
  };

  const updateFileStatus = (id, updates) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const fetchBatchEmbeddings = async (texts, config) => {
    try {
      const cleanTexts = texts.map(t => t.replace(/\n/g, ' '));

      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          input: cleanTexts
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`API Error ${response.status}${errorText ? `: ${errorText}` : ''}`);
      }

      const data = await response.json();

      if (data.data && Array.isArray(data.data)) {
        return data.data.map(item => item.embedding);
      }

      throw new Error('Unexpected response format');
    } catch (e) {
      console.error('Embedding fetch error:', e);
      throw e;
    }
  };

  const startProcessing = async () => {
    setIsProcessing(true);
    const pendingFiles = files.filter(f => f.status === 'pending' || f.status === 'error');

    for (const file of pendingFiles) {
      await processFile(file);
    }
    setIsProcessing(false);
  };

  const downloadAll = () => {
    files.filter(f => f.status === 'done').forEach(f => {
      const a = document.createElement('a');
      a.href = f.resultUrl;
      a.download = f.file.name.replace('.jsonl', '.embedded.jsonl');
      a.click();
    });
  };

  const totalFiles = files.length;
  const processedRecords = files.reduce((acc, f) => acc + (f.processed || 0), 0);
  const completedFiles = files.filter(f => f.status === 'done').length;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <div className="logo-icon">
              <Database size={20} color="white" />
            </div>
            <div className="logo-text">
              <h1>KB Embedder</h1>
              <p>Local JSONL Embedding Processor</p>
            </div>
          </div>
          <button
            className="settings-btn"
            onClick={() => setShowConfig(true)}
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="main">
        <div className="container">
          {/* Upload Zone */}
          <div
            className={`upload-zone ${isDragging ? 'dragging' : ''}`}
            onClick={() => !isProcessing && fileInputRef.current.click()}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{ cursor: isProcessing ? 'not-allowed' : 'pointer' }}
          >
            <div className="upload-icon">
              <Upload size={32} />
            </div>
            <h2>Upload JSONL Files</h2>
            <p>Click to browse or drag and drop files here</p>
            <span className="upload-hint">Multiple files supported</span>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              multiple
              accept=".jsonl,.json"
              style={{ display: 'none' }}
              disabled={isProcessing}
            />
          </div>

          {/* File List */}
          {files.length > 0 ? (
            <div className="file-list">
              <div className="list-header">
                <div className="stats">
                  <div>
                    <span className="stat-value">{totalFiles}</span>
                    <span>Files</span>
                  </div>
                  {processedRecords > 0 && (
                    <div>
                      <span className="stat-value primary">{processedRecords}</span>
                      <span>Records</span>
                    </div>
                  )}
                  {completedFiles > 0 && (
                    <div>
                      <span className="stat-value">{completedFiles}</span>
                      <span>Done</span>
                    </div>
                  )}
                </div>
                {!isProcessing && (
                  <button className="clear-btn" onClick={clearAll}>
                    <Trash2 size={16} />
                    Clear All
                  </button>
                )}
              </div>

              <table className="file-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map(file => (
                    <tr key={file.id}>
                      <td>
                        <div className="file-name">
                          <div className={`file-icon ${file.status === 'done' ? 'success' : file.status === 'error' ? 'error' : ''}`}>
                            {file.status === 'done' ? (
                              <CheckCircle2 size={20} />
                            ) : (
                              <FileJson size={20} />
                            )}
                          </div>
                          <div className="file-info">
                            <h4>{file.file.name}</h4>
                            <div className="file-size">
                              {file.file.size > 1024 * 1024
                                ? `${(file.file.size / 1024 / 1024).toFixed(2)} MB`
                                : `${(file.file.size / 1024).toFixed(2)} KB`}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`status ${file.status}`}>
                          {file.status}
                        </span>
                        {file.error && (
                          <div className="file-error-text">{file.error}</div>
                        )}
                      </td>
                      <td className="progress-cell">
                        {file.status === 'processing' ? (
                          <>
                            <div className="progress-bar">
                              <div className="progress-fill" style={{ width: `${file.progress}%` }}></div>
                            </div>
                            <div className="progress-text">{file.progress}% • {file.processed} records</div>
                          </>
                        ) : file.processed > 0 ? (
                          <div className="progress-text">{file.processed} records processed</div>
                        ) : (
                          <div className="progress-text">—</div>
                        )}
                      </td>
                      <td>
                        <div className="actions">
                          {file.status === 'done' && (
                            <a
                              href={file.resultUrl}
                              download={file.file.name.replace('.jsonl', '.embedded.jsonl')}
                              className="action-btn download"
                              title="Download"
                            >
                              <Download size={16} />
                            </a>
                          )}
                          {file.status === 'processing' && (
                            <div className="action-btn">
                              <Loader2 size={16} className="spin" />
                            </div>
                          )}
                          {(file.status === 'pending' || file.status === 'error') && (
                            <button className="action-btn delete" onClick={() => removeFile(file.id)}>
                              <X size={16} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon">
                <Database size={40} />
              </div>
              <h3>No files uploaded yet</h3>
              <p>Upload JSONL files to start embedding process</p>
            </div>
          )}
        </div>
      </main>

      {/* Bottom Bar */}
      {files.length > 0 && (
        <div className="bottom-bar">
          <div className="bottom-content">
            <div className="bottom-info">
              {isProcessing
                ? 'Processing files...'
                : `${files.filter(f => f.status === 'pending').length} file(s) ready to process`
              }
            </div>
            <div className="bottom-actions">
              {files.some(f => f.status === 'done') && (
                <button className="btn btn-secondary" onClick={downloadAll}>
                  <Download size={16} />
                  Download All
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={startProcessing}
                disabled={isProcessing || files.every(f => f.status === 'done')}
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Processing
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    Start Embedding
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config Modal */}
      {showConfig && (
        <div className="modal-overlay" onClick={() => setShowConfig(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Settings</h2>
              <button className="close-btn" onClick={() => setShowConfig(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="form-group">
              <label>API Endpoint</label>
              <input
                type="text"
                value={config.apiUrl}
                onChange={e => setConfig({ ...config, apiUrl: e.target.value })}
            placeholder="http://192.168.1.236:9989/v1/embeddings"
              />
            </div>
            <div className="form-group">
              <label>Model Name</label>
              <input
                type="text"
                value={config.model}
                onChange={e => setConfig({ ...config, model: e.target.value })}
            placeholder="Qwen3-Embedding-4B-GGUF"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
