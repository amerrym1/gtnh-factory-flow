package dev.gtnhplanner.calcoracle.structures;

import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileWriter;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

import javax.imageio.ImageIO;

import dev.gtnhplanner.calcoracle.GtnhCalcOracleMod;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.shader.Framebuffer;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;

/**
 * Renders every multiblock BlockRenderer6343 knows about to a 640px PNG.
 *
 * The 2.9 art in public/power-art was shot by hand; this exporter is the
 * repeatable version: BlockRenderer6343 builds the structure in its dummy
 * world, its own scene renderer supplies the same camera the NEI preview
 * uses, and the result is read from a framebuffer. It runs only when
 * -Dgtnh.oracle.renderStructures=true is set, so a normal dataset export
 * never touches it.
 *
 * All BlockRenderer6343 types are reached by reflection: the oracle is built
 * against the 2.9 dev jars, while the renderer jar that actually runs is the
 * one in the selected pack (2.8.4 here).
 */
public final class StructureIconExporter {

    private static final int SIZE = 640;
    private static final String OUTPUT_DIR = System.getProperty(
        "gtnh.oracle.structureOutput",
        "structures");
    private static final String HANDLER_CLASS = "blockrenderer6343.integration.gregtech.GTNEIMultiblockHandler";
    private static final String GUI_HANDLER_CLASS = "blockrenderer6343.integration.gregtech.GTGuiMultiblockHandler";
    private static final String BASE_HANDLER_CLASS = "blockrenderer6343.integration.nei.GuiMultiblockHandler";
    private static final String DATA_CLASS = "blockrenderer6343.client.utils.ConstructableData";
    private static final String SCENE_CLASS = "blockrenderer6343.client.renderer.WorldSceneRenderer";
    private static final String CONSTRUCTABLE_CLASS =
        "com.gtnewhorizon.structurelib.alignment.constructable.IConstructable";

    private StructureIconExporter() {}

    public static void exportAllThen(Runnable after) {
        Minecraft minecraft = Minecraft.getMinecraft();
        if (minecraft == null) {
            after.run();
            return;
        }
        minecraft.displayGuiScreen(new ExportScreen(after));
    }

    private static final class ExportScreen extends GuiScreen {

        private final Runnable after;
        private boolean started;

        ExportScreen(Runnable after) {
            this.after = after;
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            if (started) {
                return;
            }
            started = true;
            try {
                exportAll();
            } catch (Throwable t) {
                GtnhCalcOracleMod.LOG.error("Structure export failed.", t);
            } finally {
                after.run();
            }
        }

        @Override
        public boolean doesGuiPauseGame() {
            return false;
        }
    }

    private static void exportAll() throws Exception {
        File outDir = new File(OUTPUT_DIR);
        if (!outDir.isDirectory() && !outDir.mkdirs()) {
            throw new IllegalStateException("Could not create " + outDir);
        }

        Class<?> handlerClass = Class.forName(HANDLER_CLASS);
        @SuppressWarnings("unchecked")
        List<Object> multiblocks = (List<Object>) handlerClass.getField("multiblocksList").get(null);
        Class<?> constructableClass = Class.forName(CONSTRUCTABLE_CLASS);
        Class<?> guiHandlerClass = Class.forName(GUI_HANDLER_CLASS);
        Class<?> dataClass = Class.forName(DATA_CLASS);
        Class<?> sceneClass = Class.forName(SCENE_CLASS);
        Class<?> baseHandlerClass = Class.forName(BASE_HANDLER_CLASS);

        Method getTierData = dataClass.getMethod("getTierData", constructableClass);
        Method loadMultiblock = guiHandlerClass.getMethod(
            "loadMultiblock",
            constructableClass,
            ItemStack.class,
            dataClass);
        Method setOnCandidateChanged = guiHandlerClass.getMethod("setOnCandidateChanged", Consumer.class);
        Method setOnIngredientChanged = guiHandlerClass.getMethod("setOnIngredientChanged", Consumer.class);
        Method render = sceneClass.getMethod(
            "render",
            int.class,
            int.class,
            int.class,
            int.class,
            int.class,
            int.class);
        Field rendererField = baseHandlerClass.getDeclaredField("renderer");
        rendererField.setAccessible(true);
        Field backgroundField = sceneClass.getField("backgroundColor");
        backgroundField.setInt(null, 0);

        List<String> index = new ArrayList<String>();
        int rendered = 0;
        int failed = 0;

        GtnhCalcOracleMod.LOG.info("Rendering {} multiblock structure(s) to {}.", multiblocks.size(), outDir);

        for (Object multiblock : multiblocks) {
            ItemStack stack;
            try {
                Method getStackForm = multiblock.getClass().getMethod("getStackForm", long.class);
                stack = (ItemStack) getStackForm.invoke(multiblock, 1L);
            } catch (Throwable t) {
                failed++;
                continue;
            }
            if (stack == null || stack.getItem() == null) {
                failed++;
                continue;
            }

            String displayName = stack.getDisplayName();
            String registryName = registryName(stack);
            String fileName = safeName(displayName) + "-" + Integer.toHexString(Item.getIdFromItem(stack.getItem()))
                + "_" + stack.getItemDamage() + ".png";

            try {
                Object handler = guiHandlerClass.getConstructor().newInstance();
                setOnCandidateChanged.invoke(handler, (Consumer<List<List<ItemStack>>>) ignored -> {});
                setOnIngredientChanged.invoke(handler, (Consumer<List<ItemStack>>) ignored -> {});
                Object data = getTierData.invoke(null, multiblock);
                loadMultiblock.invoke(handler, multiblock, stack, data);

                Object renderer = rendererField.get(null);
                if (renderer == null) {
                    throw new IllegalStateException("BlockRenderer6343 scene renderer was not created.");
                }
                frameCamera(sceneClass, renderer, displayName);
                BufferedImage image = capture(renderer, render);
                ImageIO.write(image, "png", new File(outDir, fileName));
                index.add(
                    "{\"file\":\"" + json(fileName)
                        + "\",\"displayName\":\"" + json(displayName)
                        + "\",\"registryName\":\"" + json(registryName)
                        + "\",\"meta\":" + stack.getItemDamage() + "}");
                rendered++;
                if (rendered % 10 == 0) {
                    GtnhCalcOracleMod.LOG.info("Rendered {} structure(s) so far.", rendered);
                }
            } catch (Throwable t) {
                failed++;
                GtnhCalcOracleMod.LOG.warn("Could not render " + displayName + ": " + t);
            }
        }

        File indexFile = new File(outDir, "index.json");
        try (FileWriter writer = new FileWriter(indexFile)) {
            writer.write("[\n" + String.join(",\n", index) + "\n]\n");
        }
        GtnhCalcOracleMod.LOG.info(
            "Structure export finished: {} rendered, {} failed, index {}.",
            rendered,
            failed,
            indexFile.getAbsolutePath());
    }

    /**
     * The NEI preview camera is tuned for a 163x136 pane and, when driven
     * outside its GUI, can sit inside a tall structure. Frame the whole
     * bounding box instead: look at its centre from a radius that fits the
     * longest side, on the same 20/50 degree angle the preview uses.
     */
    private static void frameCamera(Class<?> sceneClass, Object renderer, String displayName) throws Exception {
        Class<?> vectorClass = Class.forName("org.joml.Vector3f");
        Object world = sceneClass.getField("world").get(renderer);
        Object size = world.getClass().getMethod("getSize").invoke(world);
        Object min = world.getClass().getMethod("getMinPos").invoke(world);
        float sx = (Float) vectorClass.getMethod("x").invoke(size);
        float sy = (Float) vectorClass.getMethod("y").invoke(size);
        float sz = (Float) vectorClass.getMethod("z").invoke(size);
        float mx = (Float) vectorClass.getMethod("x").invoke(min);
        float my = (Float) vectorClass.getMethod("y").invoke(min);
        float mz = (Float) vectorClass.getMethod("z").invoke(min);
        float longest = Math.max(sx, Math.max(sy, sz));
        if (!(longest > 0.0f)) {
            longest = 3.0f;
        }
        Object center = vectorClass.getConstructor(float.class, float.class, float.class)
            .newInstance(mx + sx / 2.0f, my + sy / 2.0f, mz + sz / 2.0f);
        double radius = Math.max(4.0, longest * 2.1);
        Method setCamera = sceneClass.getMethod(
            "setCameraLookAt",
            vectorClass,
            double.class,
            double.class,
            double.class);
        setCamera.invoke(renderer, center, radius, Math.toRadians(50.0), Math.toRadians(20.0));
        GtnhCalcOracleMod.LOG.info(
            "Structure camera {}: size=({}, {}, {}) min=({}, {}, {}) center=({}, {}, {}) radius={}",
            displayName,
            sx,
            sy,
            sz,
            mx,
            my,
            mz,
            mx + sx / 2.0f,
            my + sy / 2.0f,
            mz + sz / 2.0f,
            radius);
    }

    private static BufferedImage capture(Object renderer, Method render) throws Exception {
        Minecraft minecraft = Minecraft.getMinecraft();
        int oldWidth = minecraft.displayWidth;
        int oldHeight = minecraft.displayHeight;
        int oldScale = minecraft.gameSettings.guiScale;
        Framebuffer framebuffer = new Framebuffer(SIZE, SIZE, true);
        ByteBuffer buffer;
        try {
            framebuffer.bindFramebuffer(true);
            GL11.glViewport(0, 0, SIZE, SIZE);
            GL11.glClearColor(0.0F, 0.0F, 0.0F, 0.0F);
            GL11.glClear(GL11.GL_COLOR_BUFFER_BIT | GL11.GL_DEPTH_BUFFER_BIT);
            // ImmediateWorldSceneRenderer treats its rect as GUI coordinates and
            // scales it to the window. Make that scale 1 and the window square so
            // the rect lands on this 640x640 framebuffer exactly.
            minecraft.displayWidth = SIZE;
            minecraft.displayHeight = SIZE;
            minecraft.gameSettings.guiScale = 1;
            render.invoke(renderer, 0, 0, SIZE, SIZE, 0, 0);
            GL11.glFlush();
            buffer = BufferUtils.createByteBuffer(SIZE * SIZE * 4);
            GL11.glReadPixels(0, 0, SIZE, SIZE, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);
        } finally {
            framebuffer.unbindFramebuffer();
            framebuffer.deleteFramebuffer();
            minecraft.displayWidth = oldWidth;
            minecraft.displayHeight = oldHeight;
            minecraft.gameSettings.guiScale = oldScale;
            GL11.glViewport(0, 0, oldWidth, oldHeight);
        }
        return imageFromRgbaBuffer(buffer);
    }

    private static BufferedImage imageFromRgbaBuffer(ByteBuffer buffer) {
        BufferedImage image = new BufferedImage(SIZE, SIZE, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < SIZE; y++) {
            for (int x = 0; x < SIZE; x++) {
                int i = ((SIZE - 1 - y) * SIZE + x) * 4;
                int r = buffer.get(i) & 0xFF;
                int g = buffer.get(i + 1) & 0xFF;
                int b = buffer.get(i + 2) & 0xFF;
                int a = buffer.get(i + 3) & 0xFF;
                image.setRGB(x, y, (a << 24) | (r << 16) | (g << 8) | b);
            }
        }
        return image;
    }

    private static String registryName(ItemStack stack) {
        try {
            Object name = Item.itemRegistry.getNameForObject(stack.getItem());
            return name == null ? "" : String.valueOf(name);
        } catch (Throwable ignored) {
            return "";
        }
    }

    private static String safeName(String value) {
        String safe = value == null ? "structure" : value.toLowerCase();
        safe = safe.replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
        return safe.isEmpty() ? "structure" : safe;
    }

    private static String json(String value) {
        return value == null ? ""
            : value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", " ")
                .replace("\r", " ");
    }
}
