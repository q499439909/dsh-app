FROM dj-plan-flow-cpu:local-v1
USER root
COPY wheelhouse /tmp/wheelhouse
RUN /usr/local/bin/uv pip install --python /opt/dj-venv/bin/python --no-index --no-deps /tmp/wheelhouse/*.whl \
    && rm -rf /tmp/wheelhouse
COPY face_mask /opt/dj-capabilities/face_mask
COPY region_stats /opt/dj-capabilities/region_stats
COPY bootstrap.py /opt/dj-capabilities/bootstrap.py
USER 10001:10001
ENTRYPOINT ["/opt/dj-venv/bin/python", "/opt/dj-capabilities/bootstrap.py"]
