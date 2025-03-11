require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');
const path = require('path');
const { Readable } = require('stream');
const { Buffer } = require('buffer');
const net = require('net');

const app = express();
const defaultPort = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
logger.log("TOKENS: process.env.MAX_SUMMARY_OUTPUT_TOKENS", process.env.MAX_SUMMARY_OUTPUT_TOKENS)
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
    refillIntervalMs: 60000 / 2, // Refill a token every 30 seconds (more conservative)
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

    async executeWithRateLimit(fn) {
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

// Global status tracking
const processingStatus = {
    currentStatus: 'idle',
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
    
    return apiRateLimiter.executeWithRateLimit(async () => {
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
async function generateSummary(text) {
    logger.log(`Generating summary for text of length ${text.length} characters...`);
    processingStatus.currentStatus = 'Generating summary with GPT model';
    processingStatus.summaryProgress = 10; // Starting progress
    
    if (text.length > MAX_SUMMARY_INPUT_LENGTH) {
        logger.log(`Text exceeds maximum length for summarization (${MAX_SUMMARY_INPUT_LENGTH} characters). Truncating...`);
        text = text.substring(0, MAX_SUMMARY_INPUT_LENGTH);
    }
    
    const summaryStartTime = Date.now();
    
    try {
        processingStatus.summaryProgress = 30; // Progress update
        const completion = await openai.chat.completions.create({
            model: GPT_MODEL,
            messages: [
                {
                    role: "system",
                    content: "You are a highly skilled summarizer. Create a detailed and comprehensive summary of the provided text. Maintain the key information, main arguments, and important details while condensing the content. The summary should be thorough enough that someone reading only your summary would understand all the important aspects of the original text."
                },
                {
                    role: "user",
                    content: text
                }
            ],
            max_tokens: MAX_SUMMARY_OUTPUT_TOKENS,
            temperature: 0.7,
        });
        
        processingStatus.summaryProgress = 90; // Almost done
        const summary = completion.choices[0].message.content;
        const summaryProcessTime = (Date.now() - summaryStartTime) / 1000;
        
        logger.log(`Summary generated in ${summaryProcessTime.toFixed(2)} seconds`);
        logger.log(`Original text: ${text.length} characters, Summary: ${summary.length} characters`);
        
        processingStatus.summaryProgress = 100; // Complete
        processingStatus.currentStatus = 'Summary generation complete, preparing for TTS processing';
        
        return summary;
    } catch (error) {
        logger.error('Error generating summary:', error);
        processingStatus.currentStatus = 'Error generating summary';
        throw new Error('Failed to generate summary');
    }
}

// Endpoint to get current processing status
app.get('/api/status', (req, res) => {
    res.json(processingStatus);
});

app.post('/text-to-speech', async (req, res) => {
    logger.log('Received text-to-speech request');
    const startTime = Date.now();
    
    // Reset status for new request
    processingStatus.currentStatus = 'Starting text-to-speech processing';
    processingStatus.summaryProgress = 0;
    processingStatus.totalChunks = 0;
    processingStatus.processedChunks = 0;
    processingStatus.queuedChunks = 0;
    
    try {
        let { text, useSummary } = req.body;
        logger.log(`Original text length: ${text.length} characters, Use Summary: ${useSummary}`);
        
        // 1. Remove all newlines from the text
        text = text.replace(/\n/g, ' ').trim();
        logger.log(`Text after newline removal: ${text.length} characters`);
        
        // 2. Generate summary if requested
        let processedText = text;
        if (useSummary) {
            logger.log('Generating summary before TTS processing...');
            processedText = await generateSummary(text);
        }
        
        // 3. Split text into chunks smaller than MAX_TTS_LENGTH
        const chunks = splitTextIntoChunks(processedText, MAX_TTS_LENGTH);
        processingStatus.totalChunks = chunks.length;
        
        // 4. Process all chunks concurrently while maintaining order
        logger.log(`Processing ${chunks.length} chunks with rate limiting...`);
        processingStatus.currentStatus = `Preparing to process ${chunks.length} chunks for text-to-speech`;
        
        const processingPromises = chunks.map((chunk, index) => 
            processChunk(chunk, index, chunks.length)
        );
        
        // Wait for all chunks to be processed
        logger.log(`Waiting for all ${chunks.length} chunks to complete processing...`);
        const audioBuffers = await Promise.all(processingPromises);
        logger.log(`All ${chunks.length} chunks have been processed successfully`);
        
        // 5. Combine the audio responses in the correct order (maintained by Promise.all)
        logger.log('Combining audio chunks...');
        processingStatus.currentStatus = 'Combining audio chunks';
        const combinedBuffer = concatAudioBuffers(audioBuffers);
        
        // Send the combined audio back to the client
        processingStatus.currentStatus = 'Complete';
        res.set('Content-Type', 'audio/mpeg');
        res.send(combinedBuffer);
        
        const totalProcessTime = (Date.now() - startTime) / 1000;
        logger.log(`Request completed in ${totalProcessTime.toFixed(2)} seconds, sent ${combinedBuffer.length} bytes`);
    } catch (error) {
        logger.error('Error in text-to-speech processing:', error);
        processingStatus.currentStatus = `Error: ${error.message}`;
        res.status(500).json({ error: 'Failed to convert text to speech' });
    }
});

// Endpoint to get the config values for the frontend
app.get('/api/config', (req, res) => {
    res.json({
        maxSummaryInputLength: MAX_SUMMARY_INPUT_LENGTH,
        maxSummaryOutputTokens: MAX_SUMMARY_OUTPUT_TOKENS,
        gptModel: GPT_MODEL,
        summariserInputCost1M: SUMMARISER_INPUT_COST_1M,
        summarizerOutputCost1M: SUMMARIZER_OUTPUT_COST_1M
    });
});

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
            logger.log(`OpenAI API Key configured: ${process.env.OPENAI_API_KEY ? 'Yes' : 'No'}`);
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
