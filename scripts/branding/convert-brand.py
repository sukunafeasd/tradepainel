"""Convert the approved generated brand asset to desktop/web icon formats."""
import sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
image = Image.open(sys.argv[1]).convert("RGBA")
image.resize((512, 512), Image.Resampling.LANCZOS).save(root / "src/ui/brand.png")
image.save(root / "assets/brand/dieftrade.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
