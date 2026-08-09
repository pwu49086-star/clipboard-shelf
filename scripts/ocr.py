import sys
import os
import io

# 强制使用 UTF-8 输出
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def main():
    if len(sys.argv) < 2:
        print("")
        return

    image_path = sys.argv[1]

    if not os.path.exists(image_path):
        print("", file=sys.stderr)
        print("ERROR: Image file not found: " + image_path, file=sys.stderr)
        print("")
        return

    try:
        from rapidocr_onnxruntime import RapidOCR
        engine = RapidOCR()
        result, _ = engine(image_path)

        if result:
            texts = [item[1] for item in result]
            output = "\n".join(texts)
            print(output)
        else:
            print("")
    except ImportError:
        print("ERROR: rapidocr_onnxruntime not installed. Run: pip install rapidocr_onnxruntime", file=sys.stderr)
        print("")
    except Exception as e:
        print("ERROR: " + str(e), file=sys.stderr)
        print("")

if __name__ == "__main__":
    main()
