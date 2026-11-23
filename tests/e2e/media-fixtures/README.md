Media the live specs play, generated with ffmpeg from its own test sources (no third-party footage):

- `tone.webm`: `ffmpeg -f lavfi -i "sine=frequency=440:duration=30" -c:a libopus -b:a 16k tone.webm`
- `tone-low.webm`: the same at 330 Hz
- `clip.webm`: `ffmpeg -f lavfi -i "testsrc2=size=320x180:rate=15:duration=30" -f lavfi -i "sine=frequency=660:duration=30" -c:v libvpx -b:v 60k -c:a libopus -b:a 16k -shortest clip.webm`
