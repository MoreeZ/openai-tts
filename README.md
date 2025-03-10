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

## Technologies Used

- Backend:
  - Node.js
  - Express.js
  - OpenAI API (Text-to-Speech)
- Frontend:
  - HTML5
  - CSS3
  - JavaScript (Vanilla)

## Prerequisites

Before running this application, you need:

1. Node.js installed on your system
2. An OpenAI API key with access to the Text-to-Speech API
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

3. Create a `.env` file in the root directory and add your OpenAI API key:
   ```
   OPENAI_API_KEY=your_api_key_here
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
2. Click the "Convert to Speech" button
3. Wait for the conversion to complete
4. Use the audio player to listen to the generated speech

## Advanced Features

### Large Text Processing

The application automatically handles large text inputs by:
1. Removing all newlines for consistent processing
2. Splitting text into chunks smaller than OpenAI's 4096 character limit
3. Finding natural break points at sentence or word boundaries
4. Processing each chunk through the TTS API
5. Combining the audio responses into a single playable file

### Rate Limiting

The application implements a token bucket algorithm to handle OpenAI's rate limit of 3 requests per minute:
1. Requests are queued and processed as tokens become available
2. The system automatically calculates the optimal time to send each request
3. All chunks are processed in the correct order, even when rate limited
4. Detailed logs show the status of the queue and processing

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
