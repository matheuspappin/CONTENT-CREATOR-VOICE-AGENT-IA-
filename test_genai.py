import google.generativeai as genai
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("--api-key", required=True, help="Your Gemini API key")
args = parser.parse_args()

try:
    genai.configure(api_key=args.api_key)
    print("Available models:")
    for model in genai.list_models():
        if 'generateContent' in model.supported_generation_methods:
            print(model.name)
except Exception as e:
    print(f"An error occurred: {e}")
