from PIL import Image
import os

# Paths
input_image = r"C:\Users\Asus\.gemini\antigravity\brain\82426982-4522-4e78-ac0b-b8f3c9398a7e\extension_logo_ai_history_1772381599046.png"
output_dir = r"c:\Users\Asus\Desktop\ai-conversation-manager\icons"

# Sizes required by Chrome
sizes = [16, 48, 128]

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

# Open image
img = Image.open(input_image)

for size in sizes:
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(os.path.join(output_dir, f"icon{size}.png"))
    print(f"Generated icon{size}.png")
