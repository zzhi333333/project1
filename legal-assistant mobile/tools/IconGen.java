import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;

/**
 * 图标生成器：把用户设计图转成安卓自适应图标前景层
 *   输出 432×432（xxxhdpi 108dp）PNG：
 *   - 四角取色作为底色填充（与设计图外边距无缝融合）
 *   - 设计图缩放居中，使主体落在 66dp 安全区内
 *   用法：java IconGen <srcImage> <outPng>
 */
public class IconGen {
    public static void main(String[] args) throws Exception {
        BufferedImage src = ImageIO.read(new File(args[0]));
        int w = src.getWidth(), h = src.getHeight();

        /* 四角各取 12×12 平均色作为底色 */
        long r = 0, g = 0, b = 0;
        int[][] corners = {{2, 2}, {w - 14, 2}, {2, h - 14}, {w - 14, h - 14}};
        for (int[] c : corners) {
            for (int y = c[1]; y < c[1] + 12; y++) {
                for (int x = c[0]; x < c[0] + 12; x++) {
                    int p = src.getRGB(x, y);
                    r += (p >> 16) & 0xFF; g += (p >> 8) & 0xFF; b += p & 0xFF;
                }
            }
        }
        int n = 4 * 12 * 12;
        int br = (int) (r / n), bg = (int) (g / n), bb = (int) (b / n);
        System.out.println("BG=" + String.format("#%02X%02X%02X", br, bg, bb));

        /* 432×432 画布：底色填充 + 设计图缩放居中（主体约占 61%，落在安全区） */
        int canvas = 432;
        int art = 432;                       /* 全出血：主体铺满画布，遮罩自然裁边（与设计稿作为真实图标的呈现一致） */
        double artFrac = 0.94;               /* 设计图中主体占比（两侧留边约 3%） */
        int srcSide = (int) Math.round(art / artFrac);

        BufferedImage out = new BufferedImage(canvas, canvas, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g2 = out.createGraphics();
        g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g2.setColor(new java.awt.Color(br, bg, bb));
        g2.fillRect(0, 0, canvas, canvas);
        int off = (canvas - srcSide) / 2;
        g2.drawImage(src, off, off, srcSide, srcSide, null);
        g2.dispose();
        ImageIO.write(out, "png", new File(args[1]));
        System.out.println("OUT=" + args[1] + " (" + canvas + "x" + canvas + ", art=" + art + "px)");
    }
}
