"""Register every external module, then enter the locked plan-flow runner."""

import sys

sys.path.insert(0, "/opt/dj-capabilities/face_mask")
sys.path.insert(0, "/opt/dj-capabilities/region_stats")

import face_mask_operator  # noqa: F401,E402
import region_stats_operator  # noqa: F401,E402
from data_juicer.tools.plan_flow.container_entry import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
