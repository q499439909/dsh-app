param(
    [Parameter(Mandatory = $true)]
    [string]$PythonExe
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
    Write-Output "DJ Python does not exist: $PythonExe"
    exit 1
}

$probe = @'
from importlib.metadata import PackageNotFoundError, version
import os
import sys

opencv_distributions = []
for name in (
    "opencv-contrib-python",
    "opencv-python",
    "opencv-python-headless",
    "opencv-contrib-python-headless",
):
    try:
        opencv_distributions.append((name, version(name)))
    except PackageNotFoundError:
        pass

expected = [("opencv-contrib-python", "4.11.0.86")]
if opencv_distributions != expected:
    raise RuntimeError(
        "DJ requires exactly opencv-contrib-python==4.11.0.86; found "
        f"{opencv_distributions or 'none'}"
    )

import cv2

required_symbols = ("CascadeClassifier", "FaceDetectorYN", "data")
missing = [name for name in required_symbols if not hasattr(cv2, name)]
if missing:
    raise RuntimeError(f"cv2 {cv2.__version__} is missing required symbols: {missing}")

cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_alt.xml")
cascade = cv2.CascadeClassifier(cascade_path)
if cascade.empty():
    raise RuntimeError(f"OpenCV could not load the face cascade: {cascade_path}")

from data_juicer.ops.filter.image_face_count_filter import ImageFaceCountFilter
from data_juicer.ops.filter.image_face_ratio_filter import ImageFaceRatioFilter
from data_juicer.tools.plan_flow.runtime_environment_lock import freeze_runtime_lock

ImageFaceCountFilter(min_face_count=1, max_face_count=1)
ImageFaceRatioFilter(min_ratio=0.15, max_ratio=0.60)

print(f"DJ runtime OK: python={sys.executable}")
print(f"OpenCV distributions: {opencv_distributions}")
print(f"cv2={cv2.__version__}; face operators instantiated")
runtime_lock = freeze_runtime_lock()
print(f"uv.lock={runtime_lock['sha256']}; python={runtime_lock['python']}")
for package, expected_version in runtime_lock["audited_packages"].items():
    try:
        actual_version = version(package)
    except PackageNotFoundError:
        continue
    if actual_version != expected_version:
        print(
            f"DJ runtime warning: {package}=={actual_version} differs from uv.lock ({expected_version}); "
            "plans requiring it will be blocked"
        )
'@

$probeOutput = @(& $PythonExe -c $probe 2>&1)
$probeExitCode = $LASTEXITCODE
$probeOutput | ForEach-Object { Write-Output $_ }
exit $probeExitCode
