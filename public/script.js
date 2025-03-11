document.addEventListener('DOMContentLoaded', async () => {
    // DOM elements
    const textInput = document.getElementById('textInput');
    const convertBtn = document.getElementById('convertBtn');
    const status = document.getElementById('status');
    const audioPlayer = document.getElementById('audioPlayer');
    const charCounter = document.getElementById('charCounter');
    const costCalculator = document.getElementById('costCalculator');
    const costToggle = document.getElementById('costToggle');
    const costDetails = document.getElementById('costDetails');
    const summaryToggle = document.getElementById('summaryToggle');
    const modeLabel = document.getElementById('modeLabel');
    const modeDescription = document.getElementById('modeDescription');
    const timeEstimateElement = document.getElementById('timeEstimate');
    const timeRemainingElement = document.getElementById('timeRemaining');
    const apiKeyInput = document.getElementById('apiKey');
    const toggleApiKeyBtn = document.getElementById('toggleApiKey');
    
    // Constants for character limits - will be updated from server
    let VERBATIM_CHAR_LIMIT = 4096;
    let SUMMARY_CHAR_LIMIT = 300000;
    let MAX_SUMMARY_OUTPUT_TOKENS = 40000;
    
    // Cost calculation constants - will be updated from server
    let SUMMARISER_INPUT_COST_1M = 10;
    let SUMMARIZER_OUTPUT_COST_1M = 30;
    const SUMMARY_INPUT_OUTPUT_RATIO = 0.3;
    const AVG_CHARS_PER_TOKEN = 4;
    const TTS_COST_PER_CHAR = 0.000015;
    
    // Derived cost calculations - will be recalculated after fetching config
    let SUMMARY_INPUT_COST_PER_TOKEN = (1 / 1000000) * SUMMARISER_INPUT_COST_1M;
    let SUMMARY_OUTPUT_COST_PER_TOKEN = (SUMMARY_INPUT_OUTPUT_RATIO / 1000000) * SUMMARIZER_OUTPUT_COST_1M;
    let SUMMARY_TOTAL_COST_PER_TOKEN = SUMMARY_INPUT_COST_PER_TOKEN + SUMMARY_OUTPUT_COST_PER_TOKEN;
    let SUMMARY_COST_PER_CHAR = SUMMARY_TOTAL_COST_PER_TOKEN / AVG_CHARS_PER_TOKEN;
    
    // State variables
    let useSummaryMode = false;
    let currentCharLimit = VERBATIM_CHAR_LIMIT; 
    let costDetailsVisible = false;
    let gptModel = '';
    let statusPollingInterval;
    let processingStartTime;
    
    // API Key handling
    const API_KEY_STORAGE_KEY = 'openai_api_key';
    
    // Load API key from localStorage if available
    if (localStorage.getItem(API_KEY_STORAGE_KEY)) {
        apiKeyInput.value = localStorage.getItem(API_KEY_STORAGE_KEY);
    }
    
    // Toggle API key visibility
    toggleApiKeyBtn.addEventListener('click', function() {
        if (apiKeyInput.type === 'password') {
            apiKeyInput.type = 'text';
            toggleApiKeyBtn.textContent = 'Hide';
        } else {
            apiKeyInput.type = 'password';
            toggleApiKeyBtn.textContent = 'Show';
        }
    });
    
    // Save API key to localStorage when it changes
    apiKeyInput.addEventListener('change', function() {
        if (apiKeyInput.value.trim()) {
            localStorage.setItem(API_KEY_STORAGE_KEY, apiKeyInput.value.trim());
        } else {
            localStorage.removeItem(API_KEY_STORAGE_KEY);
        }
    });

    // Time estimation constants
    const AVERAGE_CHUNK_PROCESSING_TIME = 45; // seconds per chunk
    const RATE_LIMIT_DELAY = 30; // seconds between chunks due to rate limit
    const SUMMARY_PROCESSING_TIME = 20; // seconds for summary generation

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

    // Fetch configuration from server
    async function fetchConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) {
                throw new Error('Failed to fetch configuration');
            }
            
            const config = await response.json();
            
            // Update configuration values
            SUMMARY_CHAR_LIMIT = config.maxSummaryInputLength || SUMMARY_CHAR_LIMIT;
            MAX_SUMMARY_OUTPUT_TOKENS = config.maxSummaryOutputTokens || MAX_SUMMARY_OUTPUT_TOKENS;
            gptModel = config.gptModel || 'gpt-4o';
            
            // Update cost constants from server if available
            if (config.summariserInputCost1M !== undefined) {
                SUMMARISER_INPUT_COST_1M = config.summariserInputCost1M;
            }
            if (config.summarizerOutputCost1M !== undefined) {
                SUMMARIZER_OUTPUT_COST_1M = config.summarizerOutputCost1M;
            }
            
            // Update model costs based on the model if not provided by server
            if (config.summariserInputCost1M === undefined || config.summarizerOutputCost1M === undefined) {
                if (gptModel.includes('gpt-4o') || gptModel.includes('gpt-4')) {
                    SUMMARISER_INPUT_COST_1M = 10;
                    SUMMARIZER_OUTPUT_COST_1M = 30;
                } else if (gptModel.includes('gpt-3.5')) {
                    SUMMARISER_INPUT_COST_1M = 0.5;
                    SUMMARIZER_OUTPUT_COST_1M = 1.5;
                }
            }
            
            // Recalculate derived values
            SUMMARY_INPUT_COST_PER_TOKEN = (1 / 1000000) * SUMMARISER_INPUT_COST_1M;
            SUMMARY_OUTPUT_COST_PER_TOKEN = (SUMMARY_INPUT_OUTPUT_RATIO / 1000000) * SUMMARIZER_OUTPUT_COST_1M;
            SUMMARY_TOTAL_COST_PER_TOKEN = SUMMARY_INPUT_COST_PER_TOKEN + SUMMARY_OUTPUT_COST_PER_TOKEN;
            SUMMARY_COST_PER_CHAR = SUMMARY_TOTAL_COST_PER_TOKEN / AVG_CHARS_PER_TOKEN;
            
            // Update UI with new limits
            if (useSummaryMode) {
                modeDescription.textContent = `(Summarizes text first, max ${SUMMARY_CHAR_LIMIT.toLocaleString()} characters)`;
                currentCharLimit = SUMMARY_CHAR_LIMIT;
            } else {
                modeDescription.textContent = `(Converts exact text, max ${VERBATIM_CHAR_LIMIT.toLocaleString()} characters per chunk)`;
                currentCharLimit = VERBATIM_CHAR_LIMIT;
            }
            
            // Update the character counter and cost display
            updateCharCounter();
            
            logger.log('Configuration loaded:', {
                SUMMARY_CHAR_LIMIT,
                MAX_SUMMARY_OUTPUT_TOKENS,
                gptModel,
                SUMMARISER_INPUT_COST_1M,
                SUMMARIZER_OUTPUT_COST_1M
            });
        } catch (error) {
            logger.error('Error fetching configuration:', error);
            // Continue with default values
        }
    }

    // Toggle cost details visibility
    costToggle.addEventListener('click', () => {
        costDetailsVisible = !costDetailsVisible;
        costDetails.classList.toggle('visible', costDetailsVisible);
        costToggle.textContent = costDetailsVisible ? 'Hide calculation' : 'Show calculation';
    });

    // Function to update character counter and cost calculator
    function updateCharCounter() {
        const charCount = textInput.value.length;
        charCounter.textContent = `${charCount} characters`;
        
        // Calculate costs
        let estimatedCost, summaryCost, ttsCost;
        
        if (useSummaryMode) {
            // Summary mode: GPT-4 summarization + TTS on the summarized output
            summaryCost = charCount * SUMMARY_COST_PER_CHAR;
            ttsCost = (charCount * SUMMARY_INPUT_OUTPUT_RATIO) * TTS_COST_PER_CHAR;
            estimatedCost = (summaryCost + ttsCost).toFixed(6);
            costCalculator.innerHTML = `Estimated cost: $${estimatedCost} (${gptModel} + TTS) <button class="cost-toggle" id="costToggle">${costDetailsVisible ? 'Hide calculation' : 'Show calculation'}</button>`;
        } else {
            // Verbatim mode: TTS only
            ttsCost = charCount * TTS_COST_PER_CHAR;
            estimatedCost = ttsCost.toFixed(6);
            costCalculator.innerHTML = `Estimated cost: $${estimatedCost} (TTS only) <button class="cost-toggle" id="costToggle">${costDetailsVisible ? 'Hide calculation' : 'Show calculation'}</button>`;
        }
        
        // Update the cost details visualization
        updateCostVisualization(charCount, useSummaryMode);
        
        // Reattach event listener to the toggle button
        document.getElementById('costToggle').addEventListener('click', () => {
            costDetailsVisible = !costDetailsVisible;
            costDetails.classList.toggle('visible', costDetailsVisible);
            document.getElementById('costToggle').textContent = costDetailsVisible ? 'Hide calculation' : 'Show calculation';
        });
        
        // Update counter color based on character count
        if (charCount > currentCharLimit) {
            charCounter.className = 'character-counter error';
            if (useSummaryMode) {
                charCounter.textContent += ` (exceeds ${SUMMARY_CHAR_LIMIT.toLocaleString()} limit)`;
            } else {
                charCounter.textContent += ` (will be split into ${Math.ceil(charCount / VERBATIM_CHAR_LIMIT)} chunks)`;
            }
        } else if (charCount > currentCharLimit * 0.8) {
            charCounter.className = 'character-counter warning';
        } else {
            charCounter.className = 'character-counter';
        }
        
        // Update time estimate
        updateTimeEstimate(charCount, useSummaryMode);
    }

    // Function to update the cost visualization table
    function updateCostVisualization(charCount, isSummaryMode) {
        let tableHTML = '';
        
        // Common parameters
        tableHTML += `<tr><td>Character count</td><td>${charCount.toLocaleString()}</td></tr>`;
        
        if (isSummaryMode) {
            // Summary mode parameters
            const inputTokens = Math.ceil(charCount / AVG_CHARS_PER_TOKEN);
            const outputTokens = Math.ceil(charCount * SUMMARY_INPUT_OUTPUT_RATIO / AVG_CHARS_PER_TOKEN);
            const totalTokens = inputTokens + outputTokens;
            
            tableHTML += `<tr><td>Mode</td><td>Summary (${gptModel} + TTS)</td></tr>`;
            tableHTML += `<tr><td>Input/output ratio</td><td>${SUMMARY_INPUT_OUTPUT_RATIO}</td></tr>`;
            tableHTML += `<tr><td>Avg chars per token</td><td>${AVG_CHARS_PER_TOKEN}</td></tr>`;
            tableHTML += `<tr><td>Input tokens (est.)</td><td>${inputTokens.toLocaleString()}</td></tr>`;
            tableHTML += `<tr><td>Output tokens (est.)</td><td>${outputTokens.toLocaleString()}</td></tr>`;
            tableHTML += `<tr><td>Total tokens</td><td>${totalTokens.toLocaleString()}</td></tr>`;
            tableHTML += `<tr><td>Input cost per 1M tokens</td><td>$${SUMMARISER_INPUT_COST_1M}</td></tr>`;
            tableHTML += `<tr><td>Output cost per 1M tokens</td><td>$${SUMMARIZER_OUTPUT_COST_1M}</td></tr>`;
            tableHTML += `<tr><td>Max input characters</td><td>${SUMMARY_CHAR_LIMIT.toLocaleString()}</td></tr>`;
            tableHTML += `<tr><td>Max output tokens</td><td>${MAX_SUMMARY_OUTPUT_TOKENS.toLocaleString()}</td></tr>`;
            
            // Calculation breakdown
            const inputCost = inputTokens * SUMMARY_INPUT_COST_PER_TOKEN;
            const outputCost = outputTokens * SUMMARY_OUTPUT_COST_PER_TOKEN;
            const summaryCost = charCount * SUMMARY_COST_PER_CHAR;
            const ttsCost = (charCount * SUMMARY_INPUT_OUTPUT_RATIO) * TTS_COST_PER_CHAR;
            const totalCost = summaryCost + ttsCost;
            
            tableHTML += `<tr><td>GPT input cost</td><td>$${inputCost.toFixed(6)}</td></tr>`;
            tableHTML += `<tr><td>GPT output cost</td><td>$${outputCost.toFixed(6)}</td></tr>`;
            tableHTML += `<tr><td>Total GPT cost</td><td>$${summaryCost.toFixed(6)}</td></tr>`;
            tableHTML += `<tr><td>TTS cost (${Math.round(charCount * SUMMARY_INPUT_OUTPUT_RATIO).toLocaleString()} chars)</td><td>$${ttsCost.toFixed(6)}</td></tr>`;
            tableHTML += `<tr><td><strong>Total cost</strong></td><td><strong>$${totalCost.toFixed(6)}</strong></td></tr>`;
        } else {
            // Verbatim mode parameters
            tableHTML += `<tr><td>Mode</td><td>Verbatim (TTS only)</td></tr>`;
            tableHTML += `<tr><td>TTS cost per character</td><td>$${TTS_COST_PER_CHAR}</td></tr>`;
            tableHTML += `<tr><td>Max characters per chunk</td><td>${VERBATIM_CHAR_LIMIT.toLocaleString()}</td></tr>`;
            
            // Calculation breakdown
            const ttsCost = charCount * TTS_COST_PER_CHAR;
            
            tableHTML += `<tr><td>TTS cost (${charCount.toLocaleString()} chars)</td><td>$${ttsCost.toFixed(6)}</td></tr>`;
            tableHTML += `<tr><td><strong>Total cost</strong></td><td><strong>$${ttsCost.toFixed(6)}</strong></td></tr>`;
        }
        
        costDetailsTable.innerHTML = tableHTML;
    }

    // Calculate and display estimated processing time
    function updateTimeEstimate(charCount, isSummary, summaryLength = 0) {
        if (charCount === 0) {
            timeEstimateElement.textContent = 'Estimated processing time: 0 minutes';
            return;
        }
        
        // Calculate number of chunks
        const MAX_CHUNK_SIZE = 4096;
        const numChunks = Math.ceil(isSummary ? summaryLength / MAX_CHUNK_SIZE : charCount / MAX_CHUNK_SIZE);
        
        // Calculate processing time
        let totalSeconds = 0;
        
        // Add summary generation time if in summary mode
        if (isSummary) {
            totalSeconds += SUMMARY_PROCESSING_TIME;
        }
        
        // Add time for processing chunks
        // First chunk processes immediately
        totalSeconds += AVERAGE_CHUNK_PROCESSING_TIME;
        
        // Remaining chunks are rate-limited (one every 30 seconds)
        if (numChunks > 1) {
            totalSeconds += (numChunks - 1) * Math.max(AVERAGE_CHUNK_PROCESSING_TIME, RATE_LIMIT_DELAY);
        }
        
        // Convert to minutes and seconds
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        
        // Display the estimate
        if (minutes > 0) {
            timeEstimateElement.textContent = `Estimated processing time: ${minutes} min ${seconds} sec`;
        } else {
            timeEstimateElement.textContent = `Estimated processing time: ${seconds} sec`;
        }
    }

    // Initialize character counter and cost calculator
    updateCharCounter();

    // Fetch configuration from server
    fetchConfig();

    // Add event listener for text input to update character counter and cost
    textInput.addEventListener('input', updateCharCounter);

    // Add event listener for summary toggle
    summaryToggle.addEventListener('change', () => {
        useSummaryMode = summaryToggle.checked;
        
        if (useSummaryMode) {
            modeLabel.textContent = 'Mode: Summary TTS';
            modeDescription.textContent = `(Summarizes text first, max ${SUMMARY_CHAR_LIMIT.toLocaleString()} characters)`;
            currentCharLimit = SUMMARY_CHAR_LIMIT;
        } else {
            modeLabel.textContent = 'Mode: Verbatim TTS';
            modeDescription.textContent = `(Converts exact text, max ${VERBATIM_CHAR_LIMIT.toLocaleString()} characters per chunk)`;
            currentCharLimit = VERBATIM_CHAR_LIMIT;
        }
        
        updateCharCounter();
    });

    convertBtn.addEventListener('click', async () => {
        const text = textInput.value.trim();
        const apiKey = apiKeyInput.value.trim();
        
        if (!text) {
            status.textContent = 'Please enter some text first.';
            return;
        }
        
        if (!apiKey) {
            status.textContent = 'Please enter your OpenAI API key.';
            return;
        }
        
        // Check if text exceeds the summary limit when in summary mode
        if (useSummaryMode && text.length > SUMMARY_CHAR_LIMIT) {
            if (!confirm(`Your text exceeds the ${SUMMARY_CHAR_LIMIT.toLocaleString()} character limit for summarization. The text will be truncated. Continue?`)) {
                return;
            }
        }

        try {
            status.textContent = useSummaryMode ? 
                'Generating summary and converting to speech...' : 
                'Converting text to speech...';
            
            convertBtn.disabled = true;
            audioPlayer.style.display = 'none';
            
            // Start polling for status updates
            startStatusPolling();
            
            // Save the API key to localStorage
            localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
            
            // Prepare the request
            const requestData = {
                text,
                apiKey,
                useSummary: useSummaryMode
            };
            
            // Send the request
            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });

            if (!response.ok) {
                // Check the content type to handle HTML error pages
                const contentType = response.headers.get('content-type');
                
                if (contentType && contentType.includes('application/json')) {
                    // Handle JSON error response
                    const errorData = await response.json();
                    
                    // Format a detailed error message based on the error type
                    let errorMessage = errorData.error || 'Failed to convert text to speech';
                    
                    // Add specific handling for different error types
                    switch (errorData.type) {
                        case 'invalid_api_key':
                            errorMessage = '❌ API Key Error: ' + errorMessage;
                            errorMessage += '\n\nPlease check that your OpenAI API key is correct and has access to the TTS API.';
                            break;
                        case 'insufficient_quota':
                            errorMessage = '❌ Quota Error: ' + errorMessage;
                            errorMessage += '\n\nPlease check your OpenAI account billing status and usage limits.';
                            break;
                        case 'rate_limit_error':
                            errorMessage = '❌ Rate Limit Error: ' + errorMessage;
                            errorMessage += '\n\nThe OpenAI API is currently rate limited. Please wait a moment and try again.';
                            break;
                        case 'summary_generation_error':
                            errorMessage = '❌ Summary Error: ' + errorMessage;
                            errorMessage += '\n\nThere was a problem generating the summary. Try using verbatim mode instead.';
                            break;
                        case 'tts_processing_error':
                            errorMessage = '❌ TTS Processing Error: ' + errorMessage;
                            if (errorData.chunk && errorData.totalChunks) {
                                errorMessage += `\n\nError occurred in chunk ${errorData.chunk} of ${errorData.totalChunks}.`;
                            }
                            break;
                        case 'model_not_found':
                            errorMessage = '❌ Model Error: ' + errorMessage;
                            errorMessage += '\n\nYour API key may not have access to the required models.';
                            break;
                        default:
                            errorMessage = '❌ Error: ' + errorMessage;
                    }
                    
                    // Add error code if available
                    if (errorData.code) {
                        errorMessage += `\n\nError code: ${errorData.code}`;
                    }
                    
                    // Log detailed error information to console for debugging
                    console.error('Error details:', errorData);
                    
                    throw new Error(errorMessage);
                } else {
                    // Handle non-JSON response (like HTML error pages)
                    const errorText = await response.text();
                    console.error('Server returned non-JSON response:', errorText);
                    
                    // Create a more user-friendly error message
                    let errorMessage = '❌ Server Error: The server returned an unexpected response format.';
                    errorMessage += '\n\nThis usually indicates a server-side error or timeout.';
                    errorMessage += '\n\nPlease try again with a smaller text input or check server logs for details.';
                    errorMessage += `\n\nStatus: ${response.status} ${response.statusText}`;
                    
                    throw new Error(errorMessage);
                }
            }

            // Check content type to ensure we received audio data
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('audio/')) {
                console.error('Server returned non-audio content type:', contentType);
                throw new Error('❌ Error: Server returned an invalid response format. Expected audio data but received something else.');
            }

            const audioBlob = await response.blob();
            
            // Verify we got a valid audio blob
            if (audioBlob.size === 0) {
                throw new Error('❌ Error: Received empty audio data from the server.');
            }
            
            const audioUrl = URL.createObjectURL(audioBlob);
            
            audioPlayer.src = audioUrl;
            audioPlayer.style.display = 'block';
            audioPlayer.disabled = false;
            status.textContent = 'Conversion complete! Click play to listen.';
            
            // Clean up the previous audio URL if it exists
            audioPlayer.onloadeddata = () => {
                if (audioPlayer.dataset.previousUrl) {
                    URL.revokeObjectURL(audioPlayer.dataset.previousUrl);
                }
                audioPlayer.dataset.previousUrl = audioUrl;
            };
        } catch (error) {
            // Format the status message for better readability
            const errorMessage = error.message || 'Failed to convert text to speech.';
            
            // Create a formatted status message with line breaks for the UI
            status.innerHTML = errorMessage.replace(/\n/g, '<br>');
            
            // Log the full error to console
            console.error('Error:', error);
            
            // Stop status polling
            stopStatusPolling();
        } finally {
            convertBtn.disabled = false;
        }
    });

    // Start polling for status updates
    function startStatusPolling() {
        // Record the start time
        processingStartTime = Date.now();
        
        // Clear any existing interval
        if (statusPollingInterval) {
            clearInterval(statusPollingInterval);
        }
        
        // Show the queue status container
        document.getElementById('queueStatusContainer').style.display = 'block';
        
        // Poll every 500ms
        statusPollingInterval = setInterval(async () => {
            try {
                const response = await fetch('/api/status');
                if (!response.ok) {
                    throw new Error('Failed to fetch status');
                }
                
                const status = await response.json();
                updateStatusDisplay(status);
                updateQueueStatus(status);
                updateTimeRemaining(status);
                
                // If processing is complete, stop polling
                if (status.currentStatus === 'Complete') {
                    stopStatusPolling();
                }
            } catch (error) {
                console.error('Error fetching status:', error);
            }
        }, 500);
    }

    // Stop polling for status updates
    function stopStatusPolling() {
        if (statusPollingInterval) {
            clearInterval(statusPollingInterval);
            statusPollingInterval = null;
        }
        
        // Hide the queue status container when done
        document.getElementById('queueStatusContainer').style.display = 'none';
    }

    // Update the queue status display
    function updateQueueStatus(status) {
        // Update the queue status indicators
        document.getElementById('totalChunks').textContent = status.totalChunks;
        document.getElementById('processedChunks').textContent = status.processedChunks;
        document.getElementById('queuedChunks').textContent = status.queuedChunks;
        
        // Show or hide summary progress based on whether we're in summary mode
        const summaryProgressContainer = document.getElementById('summaryProgressContainer');
        if (status.summaryProgress > 0) {
            summaryProgressContainer.style.display = 'flex';
            document.getElementById('summaryProgress').textContent = `${status.summaryProgress}%`;
        } else {
            summaryProgressContainer.style.display = 'none';
        }
    }

    // Update the status display with the latest information
    function updateStatusDisplay(status) {
        let statusText = '';
        
        switch (status.currentStatus) {
            case 'idle':
                statusText = 'Ready to convert text to speech.';
                break;
            case 'Generating summary with GPT model':
                statusText = `Summarizing text with ${gptModel}... (${status.summaryProgress}%)`;
                break;
            case 'Summary generation complete, preparing for TTS processing':
                statusText = 'Summary generated. Preparing for text-to-speech processing...';
                break;
            case 'Complete':
                statusText = 'Conversion complete! Click play to listen.';
                stopStatusPolling();
                break;
            default:
                if (status.currentStatus.startsWith('Processing chunk')) {
                    statusText = `${status.currentStatus}`;
                } else if (status.currentStatus.startsWith('Processed')) {
                    statusText = `${status.currentStatus}`;
                } else if (status.currentStatus.startsWith('Error')) {
                    statusText = `Error: ${status.currentStatus}`;
                    stopStatusPolling();
                } else {
                    statusText = status.currentStatus;
                }
        }
        
        status.textContent = statusText;
    }

    // Update the time remaining estimate
    function updateTimeRemaining(status) {
        if (status.processedChunks === 0 && status.totalChunks === 0) {
            timeRemainingElement.textContent = 'Calculating...';
            return;
        }
        
        // If we're still generating a summary
        if (status.summaryProgress > 0 && status.summaryProgress < 100) {
            timeRemainingElement.textContent = 'Generating summary...';
            return;
        }
        
        // If all chunks are processed
        if (status.processedChunks >= status.totalChunks && status.totalChunks > 0) {
            timeRemainingElement.textContent = 'Processing complete';
            return;
        }
        
        // Calculate time spent so far
        const elapsedMs = Date.now() - processingStartTime;
        const elapsedSeconds = elapsedMs / 1000;
        
        // If we have processed at least one chunk, we can estimate based on actual time
        if (status.processedChunks > 0) {
            const secondsPerChunk = elapsedSeconds / status.processedChunks;
            const remainingChunks = status.totalChunks - status.processedChunks;
            
            // Remaining chunks will be processed at the rate limit (one every 30 seconds)
            // or at the actual observed rate, whichever is slower
            const remainingSeconds = remainingChunks * Math.max(secondsPerChunk, RATE_LIMIT_DELAY);
            
            // Convert to minutes and seconds
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = Math.floor(remainingSeconds % 60);
            
            if (minutes > 0) {
                timeRemainingElement.textContent = `${minutes} min ${seconds} sec`;
            } else {
                timeRemainingElement.textContent = `${seconds} sec`;
            }
        } else {
            // If no chunks have been processed yet, use our estimate
            const remainingChunks = status.totalChunks;
            const remainingSeconds = AVERAGE_CHUNK_PROCESSING_TIME + 
                                    (remainingChunks - 1) * Math.max(AVERAGE_CHUNK_PROCESSING_TIME, RATE_LIMIT_DELAY);
            
            // Convert to minutes and seconds
            const minutes = Math.floor(remainingSeconds / 60);
            const seconds = Math.floor(remainingSeconds % 60);
            
            if (minutes > 0) {
                timeRemainingElement.textContent = `~${minutes} min ${seconds} sec`;
            } else {
                timeRemainingElement.textContent = `~${seconds} sec`;
            }
        }
    }
});
