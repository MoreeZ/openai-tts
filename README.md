# OpenAI Text-to-Speech Web Application

A web application that converts text to speech using OpenAI's Text-to-Speech API. This application provides a simple and intuitive interface for users to input text and receive high-quality audio output using OpenAI's advanced TTS models.

## Features

- Clean and modern web interface
- Real-time text-to-speech conversion
- Built-in audio player for immediate playback
- Error handling and loading states
- Uses OpenAI's "alloy" voice (can be easily configured to use other voices)
- **Large text handling** - Automatically splits text into optimal chunks for processing
- **Concurrent processing** - Processes multiple chunks in parallel for faster results
- **Smart rate limiting** - Respects OpenAI's API rate limits (3 requests per minute) while maximizing throughput
- **Auto port selection** - Automatically finds an available port if the default port is in use
- **Detailed logging** - Provides comprehensive logs to track processing status
- **Text summarization** - Uses GPT-4o to create detailed summaries of large texts
- **Character counter** - Shows real-time character count with visual indicators
- **Mode toggle** - Switch between verbatim TTS and summary TTS modes
- **Dynamic cost calculation** - Real-time cost estimation based on input length and mode
- **Cost visualization** - Detailed breakdown of cost calculations for transparency
- **Real-time queue status** - Visual indicator showing processing progress and queue status
- **Automatic retry** - Automatically handles rate limit errors with smart backoff and retry logic

## Technologies Used

- Backend:
  - Node.js
  - Express.js
  - OpenAI API (Text-to-Speech)
  - OpenAI API (GPT-4o for summarization)
- Frontend:
  - HTML5
  - CSS3
  - JavaScript (Vanilla)

## Prerequisites

Before running this application, you need:

1. Node.js installed on your system
2. An OpenAI API key with access to the Text-to-Speech API and GPT-4o model
3. npm (Node Package Manager)

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/[your-username]/openai-tts.git
   cd openai-tts
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory and add your OpenAI API key and configuration:
   ```
   OPENAI_API_KEY=your_api_key_here
   
   # Server Configuration
   PORT=3000
   
   # GPT Model Configuration
   GPT_MODEL=gpt-4o-2024-08-06
   MAX_SUMMARY_INPUT_LENGTH=40000
   MAX_SUMMARY_OUTPUT_TOKENS=16000
   
   # Cost Calculation Constants
   SUMMARISER_INPUT_COST_1M=10
   SUMMARIZER_OUTPUT_COST_1M=30
   ```

## Running the Application

1. Start the server:
   ```bash
   npm start
   ```

2. Open your web browser and navigate to:
   ```
   http://localhost:3000
   ```
   
   Note: If port 3000 is already in use, the server will automatically select the next available port.

## Usage

1. Enter your desired text in the text area
2. Select the conversion mode:
   - **Verbatim TTS**: Converts your exact text to speech (default)
   - **Summary TTS**: First summarizes your text using GPT-4o, then converts the summary to speech
3. Monitor the character count and estimated cost in real-time
4. Click the "Show calculation" link to view a detailed breakdown of the cost calculation
5. Click the "Convert to Speech" button
6. Wait for the conversion to complete
7. Use the audio player to listen to the generated speech

## Advanced Features

### Large Text Processing

The application automatically handles large text inputs by:
1. Removing all newlines for consistent processing
2. Splitting text into chunks smaller than OpenAI's 4096 character limit
3. Finding natural break points at sentence or word boundaries
4. Processing each chunk through the TTS API
5. Combining the audio responses into a single playable file

### Text Summarization

When using Summary TTS mode:
1. The application sends your text to the GPT-4o model
2. The model creates a detailed and comprehensive summary of your text
3. The summary maintains key information and important details while condensing the content
4. The summarized text is then converted to speech using the TTS API
5. This is ideal for long documents, articles, or any text where you want a condensed audio version

### Dynamic Cost Calculation

The application provides real-time cost estimation:
1. Calculates costs differently based on the selected mode (verbatim or summary)
2. For summary mode, calculates both GPT model costs and TTS costs
3. For verbatim mode, calculates only TTS costs
4. Updates in real-time as you type
5. Provides a detailed breakdown of all cost components when "Show calculation" is clicked
6. Uses configurable cost constants that can be adjusted in the `.env` file

### Configurable Parameters

All important parameters can be configured through environment variables:
1. **GPT_MODEL**: The OpenAI model used for summarization (default: gpt-4o-2024-08-06)
2. **MAX_SUMMARY_INPUT_LENGTH**: Maximum characters allowed for summarization input (default: 40000)
3. **MAX_SUMMARY_OUTPUT_TOKENS**: Maximum tokens allowed for summarization output (default: 16000)
4. **SUMMARISER_INPUT_COST_1M**: Cost per million tokens for GPT model input (default: 10)
5. **SUMMARIZER_OUTPUT_COST_1M**: Cost per million tokens for GPT model output (default: 30)

### Rate Limiting

The application implements a sophisticated rate limiting system to handle OpenAI's rate limit of 3 requests per minute:
1. Requests are processed concurrently (up to 2 at a time) while respecting OpenAI's rate limits
2. A token-based system controls request flow with tokens refilled every 30 seconds
3. Automatic detection and handling of rate limit errors with a 30-second backoff and retry
4. All chunks are processed in the correct order, even when rate limited
5. Detailed logs show the status of the queue and processing
6. Visual queue status indicator shows real-time progress of all chunks

### Queue Status Indicator

The application provides a real-time visual queue status indicator:
1. Shows the total number of chunks being processed
2. Displays how many chunks have been processed so far
3. Indicates how many chunks are still waiting in the queue
4. For summary mode, shows the progress percentage of the summarization
5. Updates in real-time as processing progresses
6. Automatically appears during processing and hides when complete

### Multiple Server Instances

You can run multiple instances of the server simultaneously:
1. The application automatically detects if the default port (3000) is in use
2. It will increment and try the next available port (3001, 3002, etc.)
3. Each instance will log its assigned port at startup

## Security Notes

- The `.env` file containing your API key is excluded from Git via `.gitignore`
- Always keep your API keys secure and never commit them to version control
- The application uses environment variables for sensitive data

## Available Voices

The application currently uses the "alloy" voice, but you can modify `server.js` to use any of these available voices:
- alloy
- echo
- fable
- onyx
- nova
- shimmer

## Contributing

Feel free to fork this repository and submit pull requests for any improvements.

## License

This project is open source and available under the MIT License.
