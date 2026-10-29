# Renders the office sprites with Blender (Cycles).
#   blender -b -P art/render.py -- <mascot.glb> <out dir> --part=room:light|room:dark|mascot
#                                  [--quick] [--only=prefix,...]   (art/render.sh runs every part)
# One orthographic camera looks down on the whole office (az 0, so screens are rectangles):
#   room_<theme>    three side rooms (tea, treadmill, toilet) and six empty desks, screens off
#   seat_<agent>    the creature on desk 0's chair, with the shadows it casts on the room
#   stand_<agent>   the creature standing on bare floor, for the side rooms
#   solo_<agent>    the creature alone, for avatars
#   slots.json      where seats, screens, tags and side-room spots land in the picture (0..1)
# The page shifts the creature sprites to the other spots: with an orthographic camera
# a move in the world is the same move in the picture.
import bpy, json, math, os, sys, random
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
pos = [a for a in argv if not a.startswith("--")]
MASCOT = pos[0] if pos else ""
OUT = pos[1] if len(pos) > 1 else "/tmp/agent-office-render"
QUICK = "--quick" in argv
ONLY = next((a.split("=", 1)[1].split(",") for a in argv if a.startswith("--only=")), None)
# one part per process: Blender can crash resetting the scene after a glTF import
PART = next((a.split("=", 1)[1] for a in argv if a.startswith("--part=")), "room:light")
YAW = float(next((a.split("=", 1)[1] for a in argv if a.startswith("--yaw=")), -116))
os.makedirs(OUT, exist_ok=True)

AGENTS = {"claude": "#e3875f", "codex": "#8fa3c9", "gemini": "#a58be0", "grok": "#868b94", "antigravity": "#6dbf94"}
THEMES = {
    "light": dict(desk="#fbfbfa", leg="#e6e5e1", chair="#f4f4f2", base="#d9dadc", mon="#202328", wall="#fbfbfa",
                  counter="#f7f7f5", tile="#efeeea", wet="#eaeef0", deck="#dcdde0", belt="#9a9ea6", porcelain="#fbfbfb",
                  pot="#e4ddd2", world=1.0),
    "dark": dict(desk="#3d424a", leg="#33373e", chair="#474c55", base="#2c3036", mon="#121418", wall="#353a42",
                 counter="#3b4048", tile="#2e3238", wet="#2b3036", deck="#454a52", belt="#202328", porcelain="#c9ccd1",
                 pot="#5b5249", world=0.42),
}
EL = 35  # camera elevation; the reference office is seen from about this high
PPU = 180  # pixels per metre at full size
SEAT_Z = 0.49
CREATURE_H = 0.8
def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def material(name, color, rough=0.55, emit=None, strength=0.0, sheen=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Roughness"].default_value = rough
    if sheen:
        b.inputs["Sheen Weight"].default_value = sheen
    if emit:
        b.inputs["Emission Color"].default_value = lin(emit)
    b.inputs["Emission Strength"].default_value = strength
    return m


def smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True


def box(name, size, loc, mat, bevel=0.03, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = 5
        m.harden_normals = True
        smooth(o)
    o.data.materials.append(mat)
    return o


def cyl(name, r, h, loc, mat, rot=(0, 0, 0), bevel=0.01, verts=48):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object
    o.name = name
    if bevel:
        m = o.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = 4
        m.harden_normals = True
    smooth(o)
    o.data.materials.append(mat)
    return o


def blob(name, r, loc, mat, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=32, ring_count=16)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    smooth(o)
    o.data.materials.append(mat)
    return o


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        s.cycles.device = "GPU"
    except Exception as e:
        print("gpu setup failed", e)
    s.cycles.samples = 24 if QUICK else 160
    s.cycles.use_denoising = True
    s.render.film_transparent = True
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.view_settings.view_transform = "AgX"
    try:
        s.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    return s


def aim(o, target):
    o.rotation_euler = (Vector(target) - o.location).to_track_quat("-Z", "Y").to_euler()


def lights(theme):
    w = bpy.data.worlds.new("w")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = lin("#e6e9ee")
    bg.inputs["Strength"].default_value = THEMES[theme]["world"]
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 5))
    sun = bpy.context.object
    sun.location = (-4, 3, 7)
    aim(sun, (0, 0, 0))
    sun.data.energy = 3.0 if theme == "light" else 2.0
    sun.data.angle = math.radians(38)
    sun.data.color = lin("#fff4e8")[:3]
    bpy.ops.object.light_add(type="AREA", location=(0, -6, 6))
    fill = bpy.context.object
    aim(fill, (0, 2, 0.6))
    fill.data.energy = 900 if theme == "light" else 450
    fill.data.size = 10
    fill.data.color = lin("#dfe8ff")[:3]


def import_mascot(height, base, yaw=0.0):
    """Import the Tripo GLB (or a stand-in blob), scale it to `height`, feet at `base`."""
    before = set(bpy.data.objects)
    if MASCOT and os.path.exists(MASCOT):
        bpy.ops.import_scene.gltf(filepath=MASCOT)
    else:
        blob("standin", 0.5, (0, 0, 0.5), material("standin", "#f4f1ea"), (1.05, 0.9, 1))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:  # generated meshes can come with flipped patches that render black
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    k = height / (hi.z - lo.z)
    roots = [o for o in new if o.parent is None]
    bpy.ops.object.empty_add(location=(0, 0, 0))
    pivot = bpy.context.object
    for o in roots:
        o.parent = pivot
    pivot.location = (-(lo.x + hi.x) / 2 * k, -(lo.y + hi.y) / 2 * k, -lo.z * k)
    pivot.scale = (k, k, k)
    bpy.ops.object.empty_add(location=base, rotation=(0, 0, math.radians(yaw)))
    holder = bpy.context.object
    pivot.parent = holder
    print("mascot bbox", tuple(round(v, 3) for v in lo), tuple(round(v, 3) for v in hi), flush=True)
    return meshes


def tint(meshes, color):
    """Multiply the delit, near-white texture by the agent colour; black eyes stay black."""
    for o in meshes:
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            nt = m.node_tree
            b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if not b:
                continue
            inp = b.inputs["Base Color"]
            src = inp.links[0].from_socket if inp.links else None
            mix = nt.nodes.get("ao_tint")
            if mix is None:
                mix = nt.nodes.new("ShaderNodeMix")
                mix.name = "ao_tint"
                mix.data_type = "RGBA"
                mix.blend_type = "MULTIPLY"
                mix.inputs["Factor"].default_value = 1.0
                if src:
                    nt.links.new(src, mix.inputs[6])
                else:
                    mix.inputs[6].default_value = inp.default_value
                nt.links.new(mix.outputs[2], inp)
            mix.inputs[7].default_value = lin(color)
            b.inputs["Roughness"].default_value = 0.62
            b.inputs["Metallic"].default_value = 0.0
            b.inputs["Sheen Weight"].default_value = 0.35
            # a touch of self-light keeps creases from going pitch black
            nt.links.new(mix.outputs[2], b.inputs["Emission Color"])
            b.inputs["Emission Strength"].default_value = 0.06


def only_camera(objs):
    keep = set(objs)
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            o.visible_camera = o in keep


def render(name, near=None):
    """near=(x, y, z): only render the patch around a creature standing there (the rest stays clear)."""
    if ONLY and not any(name.startswith(p) for p in ONLY):
        return
    s = bpy.context.scene
    s.render.use_border = near is not None
    s.render.use_crop_to_border = False
    if near:
        x, y, z = near
        pts = [world_to_camera_view(s, s.camera, Vector((x + dx, y + dy, z + dz)))
               for dx in (-0.9, 2.0) for dy in (-1.6, 1.0) for dz in (-z, 1.15)]
        s.render.border_min_x = max(0, min(p.x for p in pts))
        s.render.border_max_x = min(1, max(p.x for p in pts))
        s.render.border_min_y = max(0, min(p.y for p in pts))
        s.render.border_max_y = min(1, max(p.y for p in pts))
    bpy.context.scene.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("rendered", name, flush=True)



# ---------------- the office ----------------
# metres; x to the right, y away from the camera, z up
DESK_X = (0.9, 3.4)
DESK_Y = (5.4, 2.4, -0.6)  # back row first
CHAIR_DY = -0.85  # the chair sits on the camera side of the desk
DESKS = [(x, y) for y in DESK_Y for x in DESK_X]
ZONES = {  # floor spots for idle creatures: (kind, x, y, z)
    "tea": [(-3.2, 5.1, 0.02), (-2.35, 4.95, 0.02), (-1.5, 5.1, 0.02)],
    "run": [(-2.45, 2.6, 0.16)],
    "wc": [(-2.9, 0.6, 0.44)],
}


def leaves(name, at, mats, n=11, spread=0.12, size=0.13, top=0.55):
    random.seed(len(name) * 7)
    for i in range(n):
        a = i / n * math.tau
        r = 0.04 + random.random() * spread
        z = top + random.random() * 0.5
        blob(f"{name}{i}", size + random.random() * 0.05, (at[0] + math.cos(a) * r, at[1] + math.sin(a) * r, z),
             mats[i % 2], (1, 1, 1.35))


def desk(i, x, y, T, m):
    o = []
    o.append(box(f"top{i}", (1.5, 0.74, 0.05), (x, y, 0.75), m["desk"], bevel=0.02))
    for sx in (-0.7, 0.7):
        for sy in (-0.32, 0.32):
            o.append(box(f"leg{i}{sx}{sy}", (0.04, 0.04, 0.72), (x + sx, y + sy, 0.36), m["leg"], bevel=0.008))
    # drawer unit under the right side
    o.append(box(f"drawers{i}", (0.42, 0.56, 0.6), (x + 0.42, y + 0.02, 0.3), m["desk"], bevel=0.02))
    for k, z in enumerate((0.47, 0.3, 0.13)):
        o.append(box(f"pull{i}{k}", (0.12, 0.01, 0.015), (x + 0.42, y - 0.265, z), m["leg"], bevel=0.004))
    # monitor at the back edge, screen toward the camera
    my = y + 0.2
    o.append(box(f"foot{i}", (0.26, 0.18, 0.015), (x - 0.15, my + 0.02, 0.785), m["mon"], bevel=0.006))
    o.append(box(f"neck{i}", (0.05, 0.03, 0.2), (x - 0.15, my + 0.06, 0.88), m["mon"], bevel=0.008))
    o.append(box(f"mon{i}", (0.66, 0.035, 0.4), (x - 0.15, my, 1.12), m["mon"], bevel=0.012))
    scr = box(f"screen{i}", (0.62, 0.002, 0.36), (x - 0.15, my - 0.019, 1.12), m["screen"], bevel=0)
    o.append(scr)
    o.append(box(f"kbd{i}", (0.4, 0.13, 0.015), (x - 0.15, y - 0.15, 0.785), m["leg"], bevel=0.005))
    o.append(box(f"mouse{i}", (0.05, 0.08, 0.02), (x + 0.15, y - 0.15, 0.785), m["leg"], bevel=0.01))
    if i in (0, 3):
        o.append(cyl(f"mug{i}", 0.04, 0.09, (x + 0.48, y + 0.1, 0.82), m["mug"], bevel=0.008))
    if i in (1, 4):
        o.append(box(f"book{i}", (0.2, 0.26, 0.03), (x + 0.45, y + 0.12, 0.79), m["book"], bevel=0.004,
                     rot=(0, 0, math.radians(-12))))
    # swivel chair, backrest toward the desk: the creature turns round to face you
    cx, cy = x, y + CHAIR_DY
    o.append(box(f"seat{i}", (0.5, 0.46, 0.07), (cx, cy, 0.45), m["chair"], bevel=0.03))
    o.append(box(f"back{i}", (0.48, 0.06, 0.5), (cx, cy + 0.24, 0.78), m["chair"], bevel=0.03,
                 rot=(math.radians(-8), 0, 0)))
    o.append(cyl(f"pole{i}", 0.025, 0.32, (cx, cy, 0.25), m["base"], bevel=0))
    for k in range(5):
        a = k / 5 * math.tau + 0.3
        o.append(box(f"spoke{i}{k}", (0.3, 0.04, 0.03), (cx + math.cos(a) * 0.15, cy + math.sin(a) * 0.15, 0.07),
                     m["base"], bevel=0.008, rot=(0, 0, a)))
        o.append(blob(f"wheel{i}{k}", 0.028, (cx + math.cos(a) * 0.29, cy + math.sin(a) * 0.29, 0.028), m["base"]))
    return o, scr


def office(theme):
    T = THEMES[theme]
    m = {
        "desk": material("desk", T["desk"], 0.42), "leg": material("leg", T["leg"], 0.5),
        "chair": material("chair", T["chair"], 0.6, sheen=0.2), "base": material("base", T["base"], 0.35),
        "mon": material("mon", T["mon"], 0.35), "screen": material("screen", "#07090c", 0.12),
        "mug": material("mug", "#e3875f", 0.35), "book": material("book", "#8fa3c9", 0.6),
        "wall": material("wall", T["wall"], 0.7), "counter": material("counter", T["counter"], 0.4),
        "tile": material("tile", T["tile"], 0.6), "wet": material("wet", T["wet"], 0.4),
        "deck": material("deck", T["deck"], 0.5), "belt": material("belt", T["belt"], 0.85),
        "porcelain": material("porcelain", T["porcelain"], 0.18), "steel": material("steel", "#c3c7cc", 0.25),
        "kraft": material("kraft", "#c99b6d", 0.7), "brown": material("brown", "#8a5a3c", 0.6),
        "lid": material("lid", "#f4efe6", 0.5), "dark": material("dark", "#2a2d33", 0.4),
        "pot": material("pot", T["pot"], 0.75), "leaf": material("leaf", "#5f9e6e", 0.55, sheen=0.3),
        "leaf2": material("leaf2", "#7bb586", 0.55, sheen=0.3),
    }
    m["steel"].node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.7
    # the floor itself only catches shadows: the page's own background shows through
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 2, 0))
    floor = bpy.context.object
    floor.name = "floor"
    floor.is_shadow_catcher = True

    # ---- side rooms, x -4.3 .. -0.9 ----
    box("tilesTea", (3.4, 2.7, 0.02), (-2.6, 5.25, 0.01), m["tile"], bevel=0.005)
    box("tilesWc", (3.4, 3.0, 0.02), (-2.6, -0.3, 0.01), m["wet"], bevel=0.005)
    # walls in front of a room stay low, or they would hide it from this camera
    box("wallL", (0.08, 8.48, 1.0), (-4.34, 2.4, 0.5), m["wall"], bevel=0.01)
    box("wallTea", (3.48, 0.08, 1.0), (-2.6, 6.6, 0.5), m["wall"], bevel=0.01)
    box("wallWc", (3.48, 0.08, 0.55), (-2.6, 1.2, 0.275), m["wall"], bevel=0.01)
    box("wallWcR", (0.08, 1.5, 0.55), (-0.86, 0.45, 0.275), m["wall"], bevel=0.01)
    # tea room: L-shaped counter, cups, coffee machine
    box("cabBack", (3.0, 0.56, 0.84), (-2.75, 6.26, 0.44), m["counter"], bevel=0.015)
    box("topBack", (3.06, 0.62, 0.05), (-2.75, 6.26, 0.885), m["counter"], bevel=0.012)
    box("cabSide", (0.56, 1.2, 0.84), (-3.97, 5.42, 0.44), m["counter"], bevel=0.015)
    box("topSide", (0.62, 1.26, 0.05), (-3.97, 5.42, 0.885), m["counter"], bevel=0.012)
    for k, x in enumerate((-3.85, -3.15, -2.45, -1.75)):
        box(f"door{k}", (0.005, 0.005, 0.7), (x, 5.97, 0.45), m["leg"], bevel=0)
    for k in range(2):
        cyl(f"kcup{k}", 0.042, 0.11, (-3.62 + k * 0.13, 6.22, 0.965), m["kraft"], bevel=0.006)
        cyl(f"klid{k}", 0.046, 0.02, (-3.62 + k * 0.13, 6.22, 1.025), m["lid"], bevel=0.006)
    for r in range(2):
        for k in range(4):
            x, y = -3.18 + k * 0.17, 6.34 - r * 0.2
            cyl(f"cup{r}{k}", 0.045, 0.1, (x, y, 0.96), m["brown"], bevel=0.008)
            cyl(f"cupLid{r}{k}", 0.048, 0.016, (x, y, 1.018), m["lid"], bevel=0.006)
    box("machine", (0.46, 0.4, 0.44), (-1.75, 6.3, 1.13), m["steel"], bevel=0.03)
    box("machineFace", (0.3, 0.02, 0.16), (-1.75, 6.09, 1.2), m["dark"], bevel=0.005)
    box("drip", (0.26, 0.12, 0.02), (-1.75, 6.07, 0.93), m["dark"], bevel=0.005)
    cyl("spout", 0.02, 0.08, (-1.75, 6.07, 1.05), m["steel"], bevel=0)
    # treadmill, running to the left
    box("deck", (1.8, 0.66, 0.12), (-2.55, 2.6, 0.08), m["deck"], bevel=0.03)
    box("belt", (1.56, 0.5, 0.012), (-2.5, 2.6, 0.146), m["belt"], bevel=0.004)
    for sy in (-0.3, 0.3):
        box(f"post{sy}", (0.06, 0.05, 1.08), (-3.28, 2.6 + sy, 0.64), m["base"], bevel=0.015,
            rot=(0, math.radians(-12), 0))
        cyl(f"rail{sy}", 0.02, 0.62, (-2.95, 2.6 + sy, 1.06), m["base"], rot=(0, math.radians(90), 0), bevel=0)
    box("console", (0.24, 0.72, 0.36), (-3.38, 2.6, 1.2), m["dark"], bevel=0.03, rot=(0, math.radians(-25), 0))
    cyl("pot1", 0.2, 0.36, (-1.3, 3.5, 0.2), m["pot"], bevel=0.03)
    leaves("plant1", (-1.3, 3.5), (m["leaf"], m["leaf2"]))
    # toilet: tank on the back wall, bowl, paper on the wall, a small basin
    box("tank", (0.46, 0.2, 0.4), (-2.9, 1.03, 0.62), m["porcelain"], bevel=0.04)
    cyl("bowl", 0.21, 0.4, (-2.9, 0.71, 0.2), m["porcelain"], bevel=0.04)
    bpy.context.object.scale = (1, 1.3, 1)
    cyl("seatRing", 0.22, 0.04, (-2.9, 0.69, 0.42), m["porcelain"], bevel=0.015)
    bpy.context.object.scale = (1, 1.32, 1)
    box("rollHolder", (0.16, 0.06, 0.02), (-2.3, 1.13, 0.78), m["steel"], bevel=0.005)
    cyl("roll", 0.06, 0.12, (-2.3, 1.09, 0.72), m["porcelain"], rot=(0, math.radians(90), 0), bevel=0.01)
    box("basinCab", (0.6, 0.44, 0.7), (-1.45, 0.92, 0.35), m["counter"], bevel=0.02)
    box("basin", (0.46, 0.32, 0.06), (-1.45, 0.91, 0.73), m["porcelain"], bevel=0.03)
    cyl("tap", 0.015, 0.14, (-1.45, 1.05, 0.81), m["steel"], bevel=0)
    cyl("pot2", 0.14, 0.26, (-3.95, -1.45, 0.14), m["pot"], bevel=0.02)
    leaves("plant2", (-3.95, -1.45), (m["leaf"], m["leaf2"]), n=8, spread=0.08, size=0.1, top=0.36)

    screens, parts = [], []
    for i, (x, y) in enumerate(DESKS):
        objs, scr = desk(i, x, y, T, m)
        parts.append(objs)
        screens.append(scr)
    return floor, screens, parts


def fit_camera():
    """Orthographic camera at azimuth 0 / elevation EL, framing every mesh but the floor."""
    s = bpy.context.scene
    e = math.radians(EL)
    up = Vector((0, math.sin(e), math.cos(e)))
    bpy.context.view_layer.update()
    us, vs = [], []
    for o in s.objects:
        if o.type != "MESH" or o.name == "floor":
            continue
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            us.append(p.x)
            vs.append(p.dot(up))
    pad = 0.3
    u0, u1, v0, v1 = min(us) - pad, max(us) + pad, min(vs) - pad, max(vs) + 0.6  # room above for tags
    w, h = u1 - u0, v1 - v0
    t = Vector(((u0 + u1) / 2, 0, 0)) + up * ((v0 + v1) / 2)
    d = Vector((0, -math.cos(e), math.sin(e))) * 30
    bpy.ops.object.camera_add(location=t + d)
    cam = bpy.context.object
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(w, h)
    cam.data.clip_end = 100
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    s.camera = cam
    s.render.resolution_x, s.render.resolution_y = round(w * PPU), round(h * PPU)
    s.render.resolution_percentage = 50 if QUICK else 100
    return cam


def to_px(cam, p):
    """World point -> fraction of the picture, from the top-left corner."""
    c = world_to_camera_view(bpy.context.scene, cam, Vector(p))
    return [round(c.x, 5), round(1 - c.y, 5)]


def slots(cam, screens):
    out = {"size": [bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y], "desks": [], "zones": []}
    for (x, y), scr in zip(DESKS, screens):
        pts = [to_px(cam, scr.matrix_world @ Vector(c)) for c in scr.bound_box]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        feet = (x, y + CHAIR_DY, SEAT_Z)
        out["desks"].append({
            "feet": to_px(cam, feet), "head": to_px(cam, (feet[0], feet[1], SEAT_Z + CREATURE_H)),
            "screen": [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)],
            "tag": to_px(cam, (x - 0.15, y + 0.2, 1.36)),
        })
    for kind, spots in ZONES.items():
        for (x, y, z) in spots:
            out["zones"].append({"kind": kind, "feet": to_px(cam, (x, y, z)), "head": to_px(cam, (x, y, z + CREATURE_H))})
    with open(os.path.join(OUT, "slots.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("slots", json.dumps(out["size"]), flush=True)


KIND, _, THEME = PART.partition(":")
if KIND == "room":
    reset()
    floor, screens, _ = office(THEME)
    cam = fit_camera()
    lights(THEME)
    if THEME == "light":
        slots(cam, screens)
    render(f"room_{THEME}")

if KIND == "mascot":
    reset()
    floor, screens, parts = office("light")
    cam = fit_camera()
    lights("light")
    room = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    sx, sy = DESKS[0][0], DESKS[0][1] + CHAIR_DY
    tx, ty, tz = ZONES["tea"][0]
    for agent, acol in AGENTS.items():
        # desk 0 and the floor only catch the creature's shadows (and hide what stands in front
        # of it); the rest of the room stays out, or it would leave a faint print of itself
        near = set(parts[0]) | {floor}
        for o in room:
            o.is_shadow_catcher = True
            o.hide_render = o not in near
        meshes = import_mascot(CREATURE_H, (sx, sy, SEAT_Z), yaw=YAW)
        tint(meshes, acol)
        render(f"seat_{agent}", (sx, sy, SEAT_Z))
        holder = meshes[0]
        while holder.parent:
            holder = holder.parent
        holder.location = (tx, ty, tz)
        for o in room:
            o.hide_render = o is not floor
        render(f"stand_{agent}", (tx, ty, tz))
        floor.hide_render = True
        render(f"solo_{agent}", (tx, ty, tz))
        for o in meshes:
            o.hide_render = True
