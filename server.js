require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
const path = require('path');
const { Readable } = require('stream');
const { Buffer } = require('buffer');
const net = require('net');
const fs = require('fs');
const { access, mkdir } = require('fs/promises');

const app = express();
const defaultPort = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Custom console logger with timestamps
const logger = {
    log: (message, ...args) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${message}`, ...args);
    },
    error: (message, ...args) => {
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] ERROR: ${message}`, ...args);
    }
};

// Create OpenAI client - will be initialized with API key from request
let openai = null;

// Environment variables with defaults
const GPT_MODEL = process.env.GPT_MODEL || 'gpt-4o-2024-08-06';
const MAX_SUMMARY_INPUT_LENGTH = parseInt(process.env.MAX_SUMMARY_INPUT_LENGTH || '300000');
const MAX_SUMMARY_OUTPUT_TOKENS = parseInt(process.env.MAX_SUMMARY_OUTPUT_TOKENS || '40000');
const SUMMARISER_INPUT_COST_1M = parseFloat(process.env.SUMMARISER_INPUT_COST_1M || '10');
const SUMMARIZER_OUTPUT_COST_1M = parseFloat(process.env.SUMMARIZER_OUTPUT_COST_1M || '30');

// Maximum character length for OpenAI TTS API
const MAX_TTS_LENGTH = 4096;

// Rate limiting configuration for OpenAI API (3 requests per minute)
const RATE_LIMIT = {
    tokensPerMinute: 3,
    maxConcurrent: 2, // Reduce from 3 to 2 concurrent requests
    refillIntervalMs: 60000 / 2, // Refill a token every 30 seconds (more conservative),
};

// Simple rate limiter for controlling concurrent API access
class RateLimiter {
    constructor(maxConcurrent) {
        this.maxConcurrent = maxConcurrent;
        this.activeRequests = 0;
        this.pendingRequests = [];
        this.availableTokens = maxConcurrent;
        
        // Set up token refill interval - one token every 30 seconds
        setInterval(() => this.refillToken(), RATE_LIMIT.refillIntervalMs);
    }

    refillToken() {
        logger.log(`Refilling rate limit token. Current tokens: ${this.availableTokens}/${this.maxConcurrent}`);
        if (this.pendingRequests.length > 0 && this.availableTokens < this.maxConcurrent) {
            // If there are waiting requests, process the next one
            const nextRequest = this.pendingRequests.shift();
            logger.log(`Processing next request from queue. Queue length: ${this.pendingRequests.length}`);
            nextRequest();
        } else {
            // Otherwise, add a token to the pool
            this.availableTokens = Math.min(this.maxConcurrent, this.availableTokens + 1);
            logger.log(`Added token to pool. Available tokens: ${this.availableTokens}/${this.maxConcurrent}`);
        }
    }

    async schedule(fn) {
        // If we have available tokens, process immediately
        if (this.availableTokens > 0) {
            this.availableTokens--;
            this.activeRequests++;
            logger.log(`Starting request immediately. Active: ${this.activeRequests}, Available tokens: ${this.availableTokens}/${this.maxConcurrent}`);
            
            try {
                return await fn();
            } catch (error) {
                // Check if this is a rate limit error
                if (error.message && error.message.includes('Rate limit reached')) {
                    logger.error('Rate limit error detected. Adding delay before retrying.');
                    // Wait for 30 seconds before retrying
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    
                    // Try again
                    logger.log('Retrying request after rate limit delay...');
                    return await fn();
                }
                throw error;
            } finally {
                this.activeRequests--;
                logger.log(`Request completed. Active: ${this.activeRequests}, Available tokens: ${this.availableTokens}/${this.maxConcurrent}`);
                // Note: We don't release tokens here - they're released on a schedule
            }
        } else {
            // No tokens available, queue the request
            logger.log(`No tokens available. Queuing request. Queue length: ${this.pendingRequests.length}`);
            
            return new Promise((resolve, reject) => {
                this.pendingRequests.push(async () => {
                    this.activeRequests++;
                    logger.log(`Starting queued request. Active: ${this.activeRequests}, Available tokens: ${this.availableTokens}/${this.maxConcurrent}`);
                    
                    try {
                        const result = await fn();
                        resolve(result);
                    } catch (error) {
                        // Check if this is a rate limit error
                        if (error.message && error.message.includes('Rate limit reached')) {
                            logger.error('Rate limit error detected in queued request. Adding delay before retrying.');
                            // Wait for 30 seconds before retrying
                            await new Promise(resolve => setTimeout(resolve, 30000));
                            
                            // Try again
                            logger.log('Retrying queued request after rate limit delay...');
                            try {
                                const result = await fn();
                                resolve(result);
                            } catch (retryError) {
                                reject(retryError);
                            }
                        } else {
                            reject(error);
                        }
                    } finally {
                        this.activeRequests--;
                        logger.log(`Queued request completed. Active: ${this.activeRequests}, Available tokens: ${this.availableTokens}/${this.maxConcurrent}`);
                    }
                });
            });
        }
    }
}

// Create a rate limiter for OpenAI API calls
const apiRateLimiter = new RateLimiter(RATE_LIMIT.maxConcurrent);

// Processing status tracking
let processingStatus = {
    currentStatus: 'Idle',
    summaryProgress: 0,
    totalChunks: 0,
    processedChunks: 0,
    queuedChunks: 0
};

// Function to split text into chunks smaller than MAX_TTS_LENGTH
function splitTextIntoChunks(text, maxLength) {
    logger.log(`Splitting text of length ${text.length} characters into chunks...`);
    const chunks = [];
    let currentIndex = 0;

    while (currentIndex < text.length) {
        // Find a good breaking point (end of sentence or word)
        let endIndex = Math.min(currentIndex + maxLength, text.length);
        
        if (endIndex < text.length) {
            // Try to find the end of a sentence (period, question mark, exclamation point)
            const sentenceEndMatch = text.substring(currentIndex, endIndex).match(/[.!?][^.!?]*$/);
            if (sentenceEndMatch) {
                endIndex = currentIndex + sentenceEndMatch.index + 1;
                logger.log(`Found sentence break at position ${endIndex}`);
            } else {
                // If no sentence end found, try to find the end of a word
                const lastSpaceMatch = text.substring(currentIndex, endIndex).match(/\s[^\s]*$/);
                if (lastSpaceMatch) {
                    endIndex = currentIndex + lastSpaceMatch.index;
                    logger.log(`Found word break at position ${endIndex}`);
                } else {
                    logger.log(`No natural break found, using hard limit at position ${endIndex}`);
                }
            }
        }
        
        chunks.push(text.substring(currentIndex, endIndex));
        currentIndex = endIndex;
    }
    
    logger.log(`Text successfully split into ${chunks.length} chunks`);
    chunks.forEach((chunk, index) => {
        logger.log(`Chunk ${index + 1}: ${chunk.length} characters`);
    });
    
    return chunks;
}

// Function to concatenate audio buffers
function concatAudioBuffers(buffers) {
    logger.log(`Concatenating ${buffers.length} audio buffers...`);
    const totalLength = buffers.reduce((acc, buffer) => acc + buffer.length, 0);
    logger.log(`Total audio length: ${totalLength} bytes`);
    return Buffer.concat(buffers, totalLength);
}

// Function to process a single chunk with OpenAI TTS API
async function processChunk(chunk, index, totalChunks) {
    logger.log(`Queuing chunk ${index + 1}/${totalChunks} (${chunk.length} characters)...`);
    processingStatus.queuedChunks++;
    
    return apiRateLimiter.schedule(async () => {
        const chunkStartTime = Date.now();
        logger.log(`Starting processing of chunk ${index + 1}/${totalChunks} (${chunk.length} characters)...`);
        processingStatus.currentStatus = `Processing chunk ${index + 1}/${totalChunks}`;
        
        try {
            const mp3 = await openai.audio.speech.create({
                model: "tts-1",
                voice: "alloy",
                input: chunk,
            });
            
            const buffer = Buffer.from(await mp3.arrayBuffer());
            const chunkProcessTime = (Date.now() - chunkStartTime) / 1000;
            logger.log(`Chunk ${index + 1}/${totalChunks} processed in ${chunkProcessTime.toFixed(2)} seconds, received ${buffer.length} bytes`);
            
            processingStatus.processedChunks++;
            processingStatus.queuedChunks--;
            processingStatus.currentStatus = `Processed ${processingStatus.processedChunks}/${processingStatus.totalChunks} chunks, ${processingStatus.queuedChunks} in queue`;
            
            return buffer;
        } catch (error) {
            logger.error(`Error processing chunk ${index + 1}/${totalChunks}:`, error);
            processingStatus.queuedChunks--;
            throw error;
        }
    });
}

// Function to generate a detailed summary using GPT model
async function generateSummary(text, apiKey) {
    try {
        // Initialize OpenAI with the provided API key
        const client = new OpenAI({
            apiKey: apiKey
        });
        
        logger.log(`Generating summary for ${text.length} characters of text...`);
        
        let summaryProgress = 0;
        const updateProgress = (progress) => {
            summaryProgress = progress;
            processingStatus.summaryProgress = progress;
        };
        
        updateProgress(10);
        
        // Call the OpenAI API to generate a summary
        const completion = await client.chat.completions.create({
            model: GPT_MODEL,
            messages: [
                {
                    role: "system",
                    content: `You are a helpful assistant that creates detailed summaries of text. 
                    Your summary should be comprehensive and capture all the key points, 
                    but more concise than the original text. Aim to reduce the length by at least 50%.
                    Maintain the original tone and style where possible.`
                },
                {
                    role: "user",
                    content: `Please summarize the following text. Keep all important details and key points:
                    
                    ${text}`
                }
            ],
            max_tokens: MAX_SUMMARY_OUTPUT_TOKENS
        });
        
        updateProgress(100);
        
        // Extract the summary from the API response
        const summary = completion.choices[0].message.content;
        logger.log(`Summary generated. Original: ${text.length} chars, Summary: ${summary.length} chars`);
        
        return summary;
    } catch (error) {
        logger.error('Error generating summary:', error);
        throw error;
    }
}

// API endpoint to get server configuration
app.get('/api/config', (req, res) => {
    res.json({
        gptModel: GPT_MODEL,
        maxSummaryInputLength: MAX_SUMMARY_INPUT_LENGTH,
        maxSummaryOutputTokens: MAX_SUMMARY_OUTPUT_TOKENS,
        inputCostPerMillion: SUMMARISER_INPUT_COST_1M,
        outputCostPerMillion: SUMMARIZER_OUTPUT_COST_1M
    });
});

// API endpoint to get current processing status
app.get('/api/status', (req, res) => {
    res.json(processingStatus);
});

// Process a text-to-speech request
app.post('/api/tts', async (req, res) => {
    try {
        // Get the text and API key from the request
        const { text, apiKey } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'No text provided. Please enter some text to convert to speech.' });
        }
        
        if (!apiKey) {
            return res.status(400).json({ error: 'No API key provided. Please enter your OpenAI API key.' });
        }
        
        // Initialize OpenAI with the provided API key
        openai = new OpenAI({
            apiKey: apiKey
        });
        
        // Reset processing status
        processingStatus = {
            currentStatus: 'Starting process',
            summaryProgress: 0,
            totalChunks: 0,
            processedChunks: 0,
            queuedChunks: 0
        };
        
        // Process the text (either directly or via summary)
        const useSummary = req.body.useSummary === true;
        let textToProcess = text;
        
        if (useSummary) {
            processingStatus.currentStatus = 'Generating summary with GPT model';
            logger.log(`Generating summary using ${GPT_MODEL}...`);
            
            // Truncate if text is too long
            if (text.length > MAX_SUMMARY_INPUT_LENGTH) {
                textToProcess = text.substring(0, MAX_SUMMARY_INPUT_LENGTH);
                logger.log(`Text truncated to ${MAX_SUMMARY_INPUT_LENGTH} characters for summarization`);
            }
            
            try {
                // Generate summary
                const summary = await generateSummary(textToProcess, apiKey);
                textToProcess = summary;
                
                processingStatus.currentStatus = 'Summary generation complete, preparing for TTS processing';
                logger.log('Summary generated. Length:', textToProcess.length);
            } catch (summaryError) {
                logger.error('Error generating summary:', summaryError);
                return res.status(500).json({ 
                    error: `Error generating summary: ${summaryError.message}`,
                    details: summaryError.response?.data || 'No additional details available',
                    code: summaryError.response?.status || 500,
                    type: 'summary_generation_error'
                });
            }
        }
        
        // Split text into chunks if needed
        const chunks = splitTextIntoChunks(textToProcess, MAX_TTS_LENGTH);
        processingStatus.totalChunks = chunks.length;
        processingStatus.queuedChunks = chunks.length;
        
        logger.log(`Processing ${chunks.length} chunks...`);
        
        // Process all chunks and collect audio buffers
        const audioBuffers = [];
        for (let i = 0; i < chunks.length; i++) {
            processingStatus.currentStatus = `Processing chunk ${i + 1} of ${chunks.length}`;
            
            try {
                // Process the chunk with rate limiting
                const audioBuffer = await apiRateLimiter.schedule(() => processText(chunks[i], apiKey));
                audioBuffers.push(audioBuffer);
                
                processingStatus.processedChunks++;
                processingStatus.queuedChunks--;
                processingStatus.currentStatus = `Processed chunk ${i + 1} of ${chunks.length}`;
                
                logger.log(`Chunk ${i + 1}/${chunks.length} processed`);
            } catch (chunkError) {
                logger.error(`Error processing chunk ${i + 1}:`, chunkError);
                
                // Provide detailed error information
                let errorMessage = `Error processing chunk ${i + 1}: ${chunkError.message}`;
                let errorDetails = 'No additional details available';
                let errorCode = 500;
                let errorType = 'tts_processing_error';
                
                // Extract OpenAI API error details if available
                if (chunkError.response?.data) {
                    errorDetails = chunkError.response.data;
                    errorCode = chunkError.response.status || 500;
                    
                    // Check for common OpenAI error types
                    if (chunkError.message.includes('Rate limit')) {
                        errorType = 'rate_limit_error';
                        errorMessage = 'OpenAI API rate limit exceeded. Please try again in a few seconds.';
                    } else if (chunkError.message.includes('invalid_api_key')) {
                        errorType = 'invalid_api_key';
                        errorMessage = 'The provided OpenAI API key is invalid. Please check your API key and try again.';
                    } else if (chunkError.message.includes('insufficient_quota')) {
                        errorType = 'insufficient_quota';
                        errorMessage = 'Your OpenAI account has insufficient quota. Please check your usage and billing information.';
                    }
                }
                
                return res.status(errorCode).json({ 
                    error: errorMessage,
                    details: errorDetails,
                    code: errorCode,
                    type: errorType,
                    chunk: i + 1,
                    totalChunks: chunks.length
                });
            }
        }
        
        // Combine all audio buffers
        logger.log('Combining audio chunks...');
        processingStatus.currentStatus = 'Combining audio chunks';
        const combinedBuffer = concatAudioBuffers(audioBuffers);
        
        // Set the status to complete
        processingStatus.currentStatus = 'Complete';
        
        // Return the audio data directly as a response
        res.set('Content-Type', 'audio/mpeg');
        return res.send(Buffer.from(combinedBuffer));
        
    } catch (error) {
        logger.error('Error processing text:', error);
        
        // Determine the appropriate error message and code
        let statusCode = 500;
        let errorMessage = `Error processing text: ${error.message}`;
        let errorDetails = 'No additional details available';
        let errorType = 'general_error';
        
        // Extract OpenAI API error details if available
        if (error.response?.data) {
            errorDetails = error.response.data;
            statusCode = error.response.status || 500;
            
            // Check for common OpenAI error types
            if (error.message.includes('Rate limit')) {
                errorType = 'rate_limit_error';
                errorMessage = 'OpenAI API rate limit exceeded. Please try again in a few seconds.';
            } else if (error.message.includes('invalid_api_key')) {
                errorType = 'invalid_api_key';
                errorMessage = 'The provided OpenAI API key is invalid. Please check your API key and try again.';
                statusCode = 401;
            } else if (error.message.includes('insufficient_quota')) {
                errorType = 'insufficient_quota';
                errorMessage = 'Your OpenAI account has insufficient quota. Please check your usage and billing information.';
                statusCode = 402;
            } else if (error.message.includes('model_not_found')) {
                errorType = 'model_not_found';
                errorMessage = 'The requested OpenAI model was not found. This may be due to an outdated API version or missing access permissions.';
                statusCode = 404;
            }
        }
        
        return res.status(statusCode).json({ 
            error: errorMessage,
            details: errorDetails,
            code: statusCode,
            type: errorType
        });
    }
});

// Legacy endpoint for backward compatibility
app.post('/api/convert', (req, res) => {
    logger.log('Received request to legacy endpoint, forwarding to /api/tts');
    req.url = '/api/tts';
    app.handle(req, res);
});

// Process a chunk of text into speech
async function processText(text, apiKey) {
    try {
        // Initialize OpenAI with the provided API key
        const client = new OpenAI({
            apiKey: apiKey
        });
        
        const mp3 = await client.audio.speech.create({
            model: "tts-1",
            voice: "alloy",
            input: text,
        });
        
        // Convert the response to a buffer
        const buffer = Buffer.from(await mp3.arrayBuffer());
        return buffer;
    } catch (error) {
        logger.error('Error in processText:', error);
        throw error;
    }
}

app.get('/', (req, res) => {
    logger.log('Serving index.html');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server on an available port
(async () => {
    try {
        const port = await findAvailablePort(defaultPort);
        app.listen(port, () => {
            logger.log(`Server running at http://localhost:${port}`);
            logger.log(`GPT Model: ${GPT_MODEL}`);
            logger.log(`Max Summary Input Length: ${MAX_SUMMARY_INPUT_LENGTH} characters`);
            logger.log(`Max Summary Output Tokens: ${MAX_SUMMARY_OUTPUT_TOKENS} tokens`);
            logger.log(`Rate limiting configured: ${RATE_LIMIT.tokensPerMinute} requests per minute`);
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
    }
})();

// Function to check if a port is in use
function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer()
            .once('error', () => {
                // Port is in use
                resolve(true);
            })
            .once('listening', () => {
                // Port is free, close the server
                server.close();
                resolve(false);
            })
            .listen(port);
    });
}

// Function to find an available port
async function findAvailablePort(startPort) {
    let port = startPort;
    while (await isPortInUse(port)) {
        logger.log(`Port ${port} is in use, trying next port...`);
        port++;
    }
    return port;
}
