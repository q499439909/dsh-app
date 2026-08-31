# PROTOTYPE — Buffalo_l + BiSeNet-R18 on CPU

Question: can the current local Docker host produce useful, pixel-level face-region
masks and identity embeddings without GPU by combining InsightFace `buffalo_l`
with the modified BiSeNet-R18 face parser?

This is throwaway validation code. It is not a published capability, a promoted
operator, or evidence that P7 has passed.

## Verdict (2026-08-31)

The combination is feasible on the current CPU-only Docker worker. A 30-image
preview completed with 30/30 successful masks and 512-dimensional embeddings in
35.55 seconds total (1.00 second average per successful image, excluding model
download and image build). Visual inspection confirmed that masks follow face,
ear and jaw contours while excluding hair, clothing and background.

The input set produces unusually low SCRFD scores for several clear faces. The
working prototype uses `det_thresh=0.10`, then selects the largest candidate for
this task's single-main-face contract. At the default 0.50 threshold only 14/30
images passed. Twelve of the final 30 images had multiple candidates, so a formal
operator must add minimum-area and landmark-geometry validation rather than rely
on the low threshold alone.

Two integration issues were found and resolved in the prototype:

- `det_thresh` must be passed to `FaceAnalysis.prepare()`; passing it only to the
  constructor is overwritten by the prepare-time default.
- InsightFace's normal OpenCV dependency must be removed from the headless image;
  otherwise it wins over `opencv-python-headless` and requires `libxcb.so.1`.

The face-region class union is 1–13: skin, brows, eyes, glasses, ears, nose,
mouth and lips. Hair, neck, clothing and hats are excluded.

Run from `D:\dsh-app`:

```powershell
pnpm run prototype:face-cpu -- -Limit 5
```

The command downloads model files once to
`D:\dsh-worker\prototype-models\buffalo-bisenet-cpu`, builds a CPU-only image,
and writes masks, overlays, embeddings and `manifest.json` below
`D:\data\face\outputs-prototype\buffalo-bisenet-cpu`.

Model notes:

- InsightFace code is MIT; its supplied pretrained models are restricted to
  non-commercial research use.
- The face-parsing repository is MIT. Its README supplies the checkpoint, but
  does not state a separate checkpoint license. This prototype must not promote
  either model into a department model store without license review.
- Containers run with `--network none`; downloads happen before execution.
