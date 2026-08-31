FROM python:3.12-slim

ARG FACE_PARSING_REV=d2e684cf1588b46145635e8fe7bcc29544e5537e

RUN python -m pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
        torch==2.7.1 torchvision==0.22.1 \
    && python -m pip install --no-cache-dir \
        insightface==1.0.1 onnxruntime==1.22.1 opencv-python-headless==4.11.0.86 \
    && python -c "import shutil, urllib.request, zipfile; rev='${FACE_PARSING_REV}'; archive='/tmp/face-parsing.zip'; urllib.request.urlretrieve('https://github.com/zllrunning/face-parsing.PyTorch/archive/'+rev+'.zip', archive); zipfile.ZipFile(archive).extractall('/tmp'); shutil.move('/tmp/face-parsing.PyTorch-'+rev, '/opt/face-parsing')" \
    && rm -f /tmp/face-parsing.zip

RUN python -m pip uninstall -y opencv-python opencv-python-headless \
    && python -m pip install --no-cache-dir opencv-python-headless==4.11.0.86

COPY prototype.py /opt/prototype/prototype.py

WORKDIR /opt/prototype
ENTRYPOINT ["python", "/opt/prototype/prototype.py"]
