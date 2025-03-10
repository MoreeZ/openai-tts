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

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Maximum character length for OpenAI TTS API
const MAX_TTS_LENGTH = 4096;

// Rate limiting configuration for OpenAI API (3 requests per minute)
const RATE_LIMIT = {
    tokensPerMinute: 3,
    maxTokens: 3,
    refillIntervalMs: 60000 / 3, // Refill a token every 20 seconds
};

// Token bucket for rate limiting
class TokenBucket {
    constructor(maxTokens, refillRate) {
        this.tokens = maxTokens;
        this.maxTokens = maxTokens;
        this.lastRefillTimestamp = Date.now();
        this.refillRate = refillRate; // tokens per millisecond
    }

    refill() {
        const now = Date.now();
        const timePassed = now - this.lastRefillTimestamp;
        const tokensToAdd = Math.floor(timePassed * this.refillRate);
        
        if (tokensToAdd > 0) {
            this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
            this.lastRefillTimestamp = now;
        }
    }

    tryConsume() {
        this.refill();
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        return false;
    }

    getNextRefillTime() {
        if (this.tokens >= 1) return 0;
        
        const tokensNeeded = 1;
        const timeNeeded = tokensNeeded / this.refillRate;
        return Math.ceil(timeNeeded);
    }
}

// Request queue for handling rate-limited API calls
class RequestQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.tokenBucket = new TokenBucket(
            RATE_LIMIT.maxTokens,
            RATE_LIMIT.tokensPerMinute / (RATE_LIMIT.refillIntervalMs * RATE_LIMIT.tokensPerMinute)
        );
    }

    async enqueue(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                task,
                resolve,
                reject
            });
            
            if (!this.processing) {
                this.processQueue();
            }
        });
    }

    async processQueue() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }

        this.processing = true;
        const { task, resolve, reject } = this.queue[0];

        if (this.tokenBucket.tryConsume()) {
            // We have a token, process the request
            this.queue.shift(); // Remove the task from the queue
            
            try {
                const result = await task();
                resolve(result);
            } catch (error) {
                reject(error);
            } finally {
                // Process the next item in the queue
                this.processQueue();
            }
        } else {
            // No tokens available, wait until next token refill
            const waitTime = this.tokenBucket.getNextRefillTime();
            console.log(`Rate limit reached. Waiting ${waitTime}ms for next token...`);
            
            setTimeout(() => {
                this.processQueue();
            }, waitTime);
        }
    }
}

// Create a request queue for OpenAI API calls
const apiQueue = new RequestQueue();

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
        console.log(`Port ${port} is in use, trying next port...`);
        port++;
    }
    return port;
}

// Function to split text into chunks smaller than MAX_TTS_LENGTH
function splitTextIntoChunks(text, maxLength) {
    console.log(`Splitting text of length ${text.length} characters into chunks...`);
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
                console.log(`Found sentence break at position ${endIndex}`);
            } else {
                // If no sentence end found, try to find the end of a word
                const lastSpaceMatch = text.substring(currentIndex, endIndex).match(/\s[^\s]*$/);
                if (lastSpaceMatch) {
                    endIndex = currentIndex + lastSpaceMatch.index;
                    console.log(`Found word break at position ${endIndex}`);
                } else {
                    console.log(`No natural break found, using hard limit at position ${endIndex}`);
                }
            }
        }
        
        chunks.push(text.substring(currentIndex, endIndex));
        currentIndex = endIndex;
    }
    
    console.log(`Text successfully split into ${chunks.length} chunks`);
    chunks.forEach((chunk, index) => {
        console.log(`Chunk ${index + 1}: ${chunk.length} characters`);
    });
    
    return chunks;
}

// Function to concatenate audio buffers
function concatAudioBuffers(buffers) {
    console.log(`Concatenating ${buffers.length} audio buffers...`);
    const totalLength = buffers.reduce((acc, buffer) => acc + buffer.length, 0);
    console.log(`Total audio length: ${totalLength} bytes`);
    return Buffer.concat(buffers, totalLength);
}

// Function to process a single chunk with OpenAI TTS API
async function processChunk(chunk, index, totalChunks) {
    console.log(`Queuing chunk ${index + 1}/${totalChunks} (${chunk.length} characters)...`);
    
    // Use the queue to handle rate limiting
    return apiQueue.enqueue(async () => {
        const chunkStartTime = Date.now();
        console.log(`Starting processing of chunk ${index + 1}/${totalChunks} (${chunk.length} characters)...`);
        
        try {
            const mp3 = await openai.audio.speech.create({
                model: "tts-1",
                voice: "alloy",
                input: chunk,
            });
            
            const buffer = Buffer.from(await mp3.arrayBuffer());
            const chunkProcessTime = (Date.now() - chunkStartTime) / 1000;
            console.log(`Chunk ${index + 1}/${totalChunks} processed in ${chunkProcessTime.toFixed(2)} seconds, received ${buffer.length} bytes`);
            
            return buffer;
        } catch (error) {
            console.error(`Error processing chunk ${index + 1}/${totalChunks}:`, error);
            throw error;
        }
    });
}

app.post('/text-to-speech', async (req, res) => {
    console.log('Received text-to-speech request');
    const startTime = Date.now();
    
    try {
        let { text } = req.body;
        console.log(`Original text length: ${text.length} characters`);
        
        // 1. Remove all newlines from the text
        text = text.replace(/\n/g, ' ').trim();
        console.log(`Text after newline removal: ${text.length} characters`);
        
        // 2. Split text into chunks smaller than MAX_TTS_LENGTH
        const chunks = splitTextIntoChunks(text, MAX_TTS_LENGTH);
        
        // 3. Process all chunks concurrently while maintaining order
        console.log(`Processing ${chunks.length} chunks with rate limiting...`);
        
        const processingPromises = chunks.map((chunk, index) => 
            processChunk(chunk, index, chunks.length)
        );
        
        // Wait for all chunks to be processed
        console.log(`Waiting for all ${chunks.length} chunks to complete processing...`);
        const audioBuffers = await Promise.all(processingPromises);
        console.log(`All ${chunks.length} chunks have been processed successfully`);
        
        // 4. Combine the audio responses in the correct order (maintained by Promise.all)
        console.log('Combining audio chunks...');
        const combinedBuffer = concatAudioBuffers(audioBuffers);
        
        // Send the combined audio back to the client
        res.set('Content-Type', 'audio/mpeg');
        res.send(combinedBuffer);
        
        const totalProcessTime = (Date.now() - startTime) / 1000;
        console.log(`Request completed in ${totalProcessTime.toFixed(2)} seconds, sent ${combinedBuffer.length} bytes`);
    } catch (error) {
        console.error('Error in text-to-speech processing:', error);
        res.status(500).json({ error: 'Failed to convert text to speech' });
    }
});

app.get('/', (req, res) => {
    console.log('Serving index.html');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server on an available port
(async () => {
    try {
        const port = await findAvailablePort(defaultPort);
        app.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
            console.log(`OpenAI API Key configured: ${process.env.OPENAI_API_KEY ? 'Yes' : 'No'}`);
            console.log(`Rate limiting configured: ${RATE_LIMIT.tokensPerMinute} requests per minute`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
    }
})();
