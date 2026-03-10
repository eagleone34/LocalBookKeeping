import pdfplumber
import sys

pdf_path = r"test_data\Business Checking - CAD Statement-6948 2026-01-02.pdf"

print("--- PDFPLUMBER TESTS ---")
try:
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0]
        
        # Test 1: extract_text with different tolerances
        print("\nTEST 1: extract_text(x_tolerance=2)")
        text1 = page.extract_text(x_tolerance=2)
        print(text1[:500])
        
        print("\nTEST 2: extract_text(layout=True) if available")
        try:
            text2 = page.extract_text(layout=True)
            print(text2[:500])
        except Exception as e:
            print(f"layout=True failed: {e}")
            
        print("\nTEST 3: extract_words()")
        words = page.extract_words(x_tolerance=2, y_tolerance=3)
        print(f"Extracted {len(words)} words. First 20:")
        for w in words[:20]:
            print(f"'{w['text']}' at x={w['x0']:.1f}, y={w['top']:.1f}")
            
except Exception as e:
    print(f"Error: {e}")
