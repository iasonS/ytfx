#!/usr/bin/env python3
"""Generate animated GIF of cute emoticons"""

import json
import os
from PIL import Image, ImageDraw, ImageFont
import sys

# The emoticons to include
emoticons = [
    '(｡◕‿‿◕｡)',
    '(∗´ര ᎑ ര`∗)',
    'ヾ( ˃ᴗ˂ )◞ • *✰',
    '(„• ֊ •„)੭',
    '( ｡•ㅅ•｡)~✧',
    'ヾ(˃ᴗ˂)◞ • *✰',
    '(´｡• ᵕ •｡` )',
    '(´｡• ω •｡`)',
    '(´꒳`)',
    '( ´▽` )',
    '(´・ω・`)',
    '( ´ ▽ ` )ﾉ',
    '(´▽｀)ノ',
    'ヾ(´▽｀)ノ',
    '(๑˃ᴗ˂)و',
    '(๑•́ ω •̀๑)',
    '(´꒳`)',
    '୧༺♡༻୨',
    '(๑>ᴗ<๑)',
    '(๑✓´◡`✓๑)',
    '(๑´ლ`๑)',
    '(๑´•.̫ • ๑)',
    '(´∀｀)♡',
    '( ´ ▽ ` )ノ',
    '(´ ∀ ｀)♡',
    '(*´▽`*)',
    '(´｡• ᵕ •｡`)',
    '(´ ▽｀)',
    '٩(◕‿◕｡)۶',
    '(๑ᐪᄇᐪ)ﻭ✧',
]

def generate_gif(output_path='public/emoticons.gif', frame_duration=50):
    """Generate animated GIF from emoticons"""

    # Create public directory if it doesn't exist
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Create frames
    frames = []
    frame_size = (480, 240)
    bg_color = (13, 13, 13)  # #0d0d0d
    text_color = (0, 255, 65)  # #00ff41

    print(f'📸 Generating {len(emoticons)} frames...')

    for i, emoticon in enumerate(emoticons):
        # Create image
        img = Image.new('RGB', frame_size, bg_color)
        draw = ImageDraw.Draw(img)

        # Try to use a nice font, fall back to default
        try:
            font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 80)
        except:
            font = ImageFont.load_default()

        # Draw emoticon centered
        bbox = draw.textbbox((0, 0), emoticon, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        x = (frame_size[0] - text_width) // 2
        y = (frame_size[1] - text_height) // 2

        draw.text((x, y), emoticon, fill=text_color, font=font)
        frames.append(img)

        if (i + 1) % 5 == 0:
            print(f'  Generated {i + 1}/{len(emoticons)} frames')

    print(f'🎬 Saving GIF to {output_path}...')
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=frame_duration,
        loop=0,
        optimize=False
    )

    print(f'✅ GIF created successfully: {output_path}')
    print(f'   Size: {len(frames)} frames @ {frame_duration}ms each')

if __name__ == '__main__':
    try:
        generate_gif()
    except Exception as e:
        print(f'❌ Error: {e}')
        sys.exit(1)
