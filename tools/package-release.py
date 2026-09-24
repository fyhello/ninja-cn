import os
import sys
import zipfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist_dir = os.path.join(root, "dist", "POE-Ninja-three-language-v0.2.14")
zip_path = os.path.join(root, "dist", "POE-Ninja-three-language-v0.2.14.zip")

if os.path.exists(zip_path):
    os.remove(zip_path)

print(f"正在打包目录: {dist_dir}")
print(f"目标 ZIP 包: {zip_path}")

with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zipf:
    for foldername, subfolders, filenames in os.walk(dist_dir):
        for filename in filenames:
            filepath = os.path.join(foldername, filename)
            arcname = os.path.relpath(filepath, dist_dir)
            zipf.write(filepath, arcname)

size = os.path.getsize(zip_path)
print("\n====================================================")
print("最终可分发压缩包已成功生成！")
print(f"文件绝对路径: {zip_path}")
print(f"安装包最终体积: {size / 1024 / 1024:.2f} MB ({size / 1024:.1f} KB)")
print("====================================================")
