#!/usr/bin/env python3
# test_mrp.py - Simple test script for MRP engine

import sys
import os

print("Test script starting...")
print(f"Python version: {sys.version}")
print(f"Current directory: {os.getcwd()}")

try:
    import pandas as pd
    print("Pandas imported successfully")
    print(f"Pandas version: {pd.__version__}")
except ImportError as e:
    print(f"Failed to import pandas: {e}")
    sys.exit(1)

try:
    import bom_network
    print("bom_network imported successfully")
except ImportError as e:
    print(f"Failed to import bom_network: {e}")
    sys.exit(1)

# Test file existence
files_to_check = [
    r"D:\Python projects\Dixon MPS\BOM.xlsx",
    r"D:\Python projects\Dixon MPS\demand.xlsx", 
    r"D:\Python projects\Dixon MPS\stock.xlsx",
    r"D:\Python projects\Dixon MPS\PO.xlsx"
]

for file_path in files_to_check:
    if os.path.exists(file_path):
        print(f"✓ File exists: {file_path}")
    else:
        print(f"✗ File missing: {file_path}")

print("Test script completed.")

