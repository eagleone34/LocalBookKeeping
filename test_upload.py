import requests
import time

url = "http://127.0.0.1:8000/api/documents/upload"
files = {'files': open('test_data/Business Checking - CAD Statement-6948 2026-01-02.pdf', 'rb')}

print("Starting upload...")
t0 = time.time()
try:
    response = requests.post(url, files=files)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
except Exception as e:
    print(f"Error: {e}")
print(f"Took {time.time() - t0:.2f}s")
