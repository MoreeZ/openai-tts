document.addEventListener('DOMContentLoaded', () => {
    const textInput = document.getElementById('textInput');
    const convertBtn = document.getElementById('convertBtn');
    const status = document.getElementById('status');
    const audioPlayer = document.getElementById('audioPlayer');

    convertBtn.addEventListener('click', async () => {
        const text = textInput.value.trim();
        
        if (!text) {
            status.textContent = 'Please enter some text first.';
            return;
        }

        try {
            status.textContent = 'Converting text to speech...';
            convertBtn.disabled = true;
            
            const response = await fetch('/text-to-speech', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text }),
            });

            if (!response.ok) {
                throw new Error('Failed to convert text to speech');
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);
            
            audioPlayer.src = audioUrl;
            audioPlayer.style.display = 'block';
            status.textContent = 'Conversion complete! Click play to listen.';
            
            // Clean up the previous audio URL if it exists
            audioPlayer.onloadeddata = () => {
                if (audioPlayer.dataset.previousUrl) {
                    URL.revokeObjectURL(audioPlayer.dataset.previousUrl);
                }
                audioPlayer.dataset.previousUrl = audioUrl;
            };

        } catch (error) {
            status.textContent = 'Error: Failed to convert text to speech.';
            console.error('Error:', error);
        } finally {
            convertBtn.disabled = false;
        }
    });
});
