import type { FortunePreview } from "@/lib/client-api";

/** Builds a shareable card locally. Birth inputs never enter the image. */
export async function downloadFortuneCard(preview: FortunePreview) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이 브라우저에서는 이미지 저장을 지원하지 않습니다.");
  const font = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const wrap = (text: string, size: number, width: number) => {
    context.font = `400 ${size}px ${font}`;
    const result: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const word of paragraph.trim().split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (context.measureText(candidate).width <= width) {
          line = candidate;
          continue;
        }
        if (line) result.push(line);
        line = "";
        if (context.measureText(word).width <= width) {
          line = word;
          continue;
        }
        // Split only a single word that cannot fit on an otherwise empty line.
        for (const letter of Array.from(word)) {
          if (line && context.measureText(line + letter).width > width) {
            result.push(line);
            line = letter;
          } else line += letter;
        }
      }
      result.push(line);
    }
    return result;
  };
  const paragraph = (text: string, x: number, y: number, width: number, height: number, initialSize: number, color: string) => {
    let size = initialSize;
    let lines = wrap(text, size, width);
    while (lines.length * size * 1.65 > height && size > 18) { size -= 1; lines = wrap(text, size, width); }
    context.fillStyle = color;
    context.font = `400 ${size}px ${font}`;
    lines.forEach((line, index) => context.fillText(line, x, y + index * size * 1.65));
  };
  context.fillStyle = "#f5f4e9";
  context.fillRect(0, 0, 1080, 1350);
  context.strokeStyle = "#dde4cd";
  context.lineWidth = 2;
  context.beginPath(); context.arc(960, 115, 185, 0, Math.PI * 2); context.stroke();
  context.beginPath(); context.arc(980, 115, 150, 0, Math.PI * 2); context.stroke();
  context.fillStyle = "#7c8f69";
  context.font = `600 22px ${font}`;
  context.fillText("A LITTLE INSIGHT, JUST FOR YOU", 90, 110);
  context.fillStyle = "#334d37";
  context.font = `700 59px ${font}`;
  context.fillText("오늘, 나를 위한", 86, 215);
  context.fillText("한 문장.", 86, 292);
  context.fillStyle = "#8d987b";
  context.font = `400 25px ${font}`;
  context.fillText(preview.date, 90, 351);
  context.fillStyle = "#e5ebd9";
  context.beginPath(); context.roundRect(70, 400, 940, 425, 28); context.fill();
  context.fillStyle = "#61774d";
  context.font = `600 24px ${font}`;
  context.fillText("오늘의 흐름", 112, 468);
  paragraph(preview.reading.overall, 112, 536, 850, 247, 33, "#405a38");
  context.fillStyle = "#a47446";
  context.font = `600 24px ${font}`;
  context.fillText("오늘의 작은 실천", 91, 905);
  paragraph(preview.reading.action, 91, 968, 885, 171, 31, "#61714f");
  context.strokeStyle = "#d9dfca";
  context.beginPath(); context.moveTo(90, 1170); context.lineTo(990, 1170); context.stroke();
  paragraph("재미와 자기 성찰을 위한 콘텐츠입니다. 오늘의 선택은 나에게 있어요.", 90, 1225, 755, 72, 21, "#899879");
  context.fillStyle = "#798967";
  context.font = `700 29px ${font}`;
  context.fillText("insauto.", 850, 1270);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.94));
  if (!blob) throw new Error("이미지를 저장하지 못했습니다. 다시 시도해 주세요.");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `insauto-fortune-${preview.date}.jpg`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
