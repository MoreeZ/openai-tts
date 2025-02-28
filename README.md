# OpenAI Text-to-Speech Web Application

A web application that converts text to speech using OpenAI's Text-to-Speech API. This application provides a simple and intuitive interface for users to input text and receive high-quality audio output using OpenAI's advanced TTS models.

## Features

- Clean and modern web interface
- Real-time text-to-speech conversion
- Built-in audio player for immediate playback
- Error handling and loading states
- Uses OpenAI's "alloy" voice (can be easily configured to use other voices)

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

## Usage

1. Enter your desired text in the text area
2. Click the "Convert to Speech" button
3. Wait for the conversion to complete
4. Use the audio player to listen to the generated speech

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
