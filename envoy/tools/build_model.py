"""Build envoy-model.js: every part of ENVOY V1 as separately movable pieces.

Inputs : envoy.glb (KiCad board export, inches) + the two enclosure STEP files
         already converted to GLB by cascadio (metres, KiCad STEP coordinates).
Output : envoy-model.js  ->  window.ENVOY_MODEL = { manifest, data(base64) }

Scene frame: millimetres, Y up, origin at the centre of the board's mid-plane.
"""
import json, struct, base64, sys, math, os
import numpy as np
import trimesh

GLB = sys.argv[1]
FRAME_GLB, TRAY_GLB = sys.argv[2], sys.argv[3]
OUT = sys.argv[4]

# ---------------------------------------------------------------- glb reader
f = open(GLB, 'rb').read()
clen, _ = struct.unpack('<I4s', f[12:20])
J = json.loads(f[20:20 + clen])
BIN = f[20 + clen + 8:]

def accessor(i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]
    arr = np.frombuffer(BIN, dtype=dt, count=a['count'] * n, offset=bv.get('byteOffset', 0) + a.get('byteOffset', 0))
    return arr.reshape(-1, n) if n > 1 else arr

def board_to_scene(p):
    # raw glTF inches -> KiCad mm -> scene (checked against silkscreen text + enclosure fit)
    p = p.astype(np.float64) * 25.4
    return np.c_[p[:, 0] - 359.49, p[:, 1] + 42.93, p[:, 2] + 187.48]

def step_to_scene(v):
    v = v * 1000.0
    return np.c_[v[:, 0] - 52.2, v[:, 2] - 0.8, -v[:, 1] - 83.05]

# ------------------------------------------------------------ connectivity
def components(pos, tris, q=2.5e-3):
    key = np.round(pos / q).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    t = inv[tris]
    parent = np.arange(inv.max() + 1)
    def find(x):
        r = x
        while parent[r] != r: r = parent[r]
        while parent[x] != r: parent[x], x = r, parent[x]
        return r
    for a, b, c in t:
        ra = find(a); parent[find(b)] = ra; parent[find(c)] = ra
    return np.array([find(x[0]) for x in t])

# ------------------------------------------------------------- materials
ROLE = {0: 'ledBody', 1: 'lead', 2: 'plastic', 3: 'lead', 4: 'resBody', 5: 'lead',
        6: 'enc', 7: 'enc', 8: 'enc', 9: 'enc', 10: 'smd', 11: 'devkit', 12: 'shield',
        13: 'gold', 14: 'white', 15: 'gold', 16: 'copperMetal', 17: 'plastic', 18: 'lead',
        19: 'buttonTop', 20: 'copper', 21: 'pad', 22: 'copper', 23: 'silk', 24: 'mask',
        25: 'mask', 26: 'core'}
mats = {}
for pi, p in enumerate(J['meshes'][0]['primitives']):
    m = J['materials'][p['material']]; pbr = m.get('pbrMetallicRoughness', {})
    mats.setdefault(ROLE[pi], dict(color=[round(c, 4) for c in pbr.get('baseColorFactor', [1, 1, 1, 1])[:3]],
                                   metal=pbr.get('metallicFactor', 1), rough=pbr.get('roughnessFactor', 1)))
mats['enclosure'] = dict(color=[0.55, 0.04, 0.02], metal=0.0, rough=0.62)   # Ember colourway

# ------------------------------------------------------------- raw pieces
raw = []   # dict(prim, pos(scene), tris)
for pi, p in enumerate(J['meshes'][0]['primitives']):
    pos = board_to_scene(accessor(p['attributes']['POSITION']))
    tris = accessor(p['indices']).astype(np.int64).reshape(-1, 3)
    if pi >= 20:
        if pi in (20, 21, 22):
            # plated-hole barrel walls sit inside the board and are never seen; keep the flat copper
            n = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
            ny = np.abs(n[:, 1]) / np.maximum(np.linalg.norm(n, axis=1), 1e-12)
            # back-side copper is a mirror of the front and only shows from underneath; keep the front
            cy = pos[tris].mean(1)[:, 1]
            tris = tris[(ny > 0.1) & (cy > 0)]
        raw.append(dict(prim=pi, pos=pos, tris=tris)); continue
    roots = components(accessor(p['attributes']['POSITION']).astype(np.float64) * 25.4, tris)
    for r in np.unique(roots):
        raw.append(dict(prim=pi, pos=pos, tris=tris[roots == r]))

def bbox(pc):
    v = pc['pos'][np.unique(pc['tris'])]
    return v.min(0), v.max(0)
for pc in raw:
    pc['min'], pc['max'] = bbox(pc)

# --------------------------------------------- cluster pieces into footprints
comp = [pc for pc in raw if pc['prim'] <= 19]
n = len(comp); par = list(range(n))
def fnd(x):
    while par[x] != x: par[x] = par[par[x]]; x = par[x]
    return x
tol = 0.25
for i in range(n):
    for k in range(i + 1, n):
        a, b = comp[i], comp[k]
        if np.all(a['min'] - tol <= b['max']) and np.all(b['min'] - tol <= a['max']):
            par[fnd(i)] = fnd(k)
clusters = {}
for i in range(n): clusters.setdefault(fnd(i), []).append(comp[i])

# designators read off the silkscreen (scene x, z of each footprint's centre)
REF = {
 'U1': (-8.97, -22.15), 'SW3': (15.78, -35.50), 'R10': (10.78, -23.93), 'D1': (16.08, -22.50),
 'R8': (10.78, -14.74), 'R7': (15.28, -14.74), 'R6': (19.78, -14.74), 'U2': (18.59, 0.36),
 'R13': (7.28, -3.75), 'R11': (11.28, -3.75), 'R9': (9.28, 7.75), 'U7': (-12.95, 14.20),
 'R4': (11.78, 16.26), 'R3': (16.28, 15.25), 'R14': (21.28, 15.25),
 'SW1': (-16.22, 28.75), 'SW2': (0.03, 28.75), 'SW4': (15.78, 28.75),
 'D2': (-16.26, 41.30), 'D4': (-0.24, 41.30), 'D3': (15.78, 41.30),
 'R5': (-7.46, 40.01), 'R12': (8.54, 41.51),
}
INFO = {
 'U1': ('ESP32 DevKit V1', 'module', 'The brain. Dual-core ESP32 with Bluetooth LE, riding on two 15-pin headers.'),
 'SW1': ('Rotary encoder', 'encoder', 'Endless knob with a push switch. Every detent becomes one BLE-MIDI message.'),
 'SW2': ('Rotary encoder', 'encoder', 'Endless knob with a push switch. Every detent becomes one BLE-MIDI message.'),
 'SW4': ('Rotary encoder', 'encoder', 'Endless knob with a push switch. Every detent becomes one BLE-MIDI message.'),
 'SW3': ('Master button', 'button', '12 mm tactile switch. The one control you hit with your foot or thumb mid-song.'),
 'U2': ('DIP-16 IC', 'ic', '16-pin DIP package, 7.62 mm between the pin rows.'),
 'U7': ('DIP-16 IC', 'ic', '16-pin DIP package, 7.62 mm between the pin rows.'),
}
for d in ['D1', 'D2', 'D3', 'D4']:
    INFO[d] = ('5 mm LED', 'led', '5 mm indicator. One beside each encoder, one by the master button.')
for d in ['R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14']:
    INFO[d] = ('Axial resistor', 'resistor', 'DIN0207 body stood on end, 6.3 × 2.5 mm, with two tinned leads. This is the earlier through-hole board: the latest revision uses SMD resistors.')

parts = {}
for cl in clusters.values():
    mn = np.min([c['min'] for c in cl], 0); mx = np.max([c['max'] for c in cl], 0)
    cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
    ref = min(REF, key=lambda r: (REF[r][0] - cx) ** 2 + (REF[r][1] - cz) ** 2)
    dist = math.hypot(REF[ref][0] - cx, REF[ref][1] - cz)
    assert dist < 0.6, (ref, dist, cx, cz)
    assert ref not in parts, ref
    parts[ref] = cl
assert len(parts) == len(REF), sorted(set(REF) - set(parts))

# -------------------- split each encoder's main body into body / shaft / legs
def split_encoder(cl):
    out = []
    for pc in cl:
        if pc['prim'] != 8:
            out.append(pc); continue
        pos, tris = pc['pos'], pc['tris']
        c = pos[tris].mean(1)
        top = c[:, 1] > 16
        ax = np.array([c[top, 0].mean(), 0, c[top, 2].mean()])
        r = np.hypot(c[:, 0] - ax[0], c[:, 2] - ax[2])
        legs = c[:, 1] < 1.0
        shaft = (~legs) & (c[:, 1] > 7.6) & (r < 3.7)
        body = ~(legs | shaft)
        for mask, tag in [(legs, 'legs'), (shaft, 'shaft'), (body, 'body')]:
            if mask.sum():
                q = dict(prim=8, pos=pos, tris=tris[mask], tag=tag)
                q['min'], q['max'] = bbox(q); out.append(q)
    for q in out:
        if q.get('tag'): continue
        sy = q['max'][1] - q['min'][1]; cy = (q['max'][1] + q['min'][1]) / 2
        q['tag'] = 'plate' if (sy < 0.6 and cy < 9) else 'nut' if sy < 0.6 else 'bushing'
    return out
for d in ['SW1', 'SW2', 'SW4']:
    parts[d] = split_encoder(parts[d])

# ---------------- name the ESP32 DevKit's own sub-parts from size + material
def near(a, b, t=0.3): return abs(a - b) < t
for pc in parts['U1']:
    s = pc['max'] - pc['min']; role = ROLE[pc['prim']]
    tag = 'smd'
    if role == 'devkit' and s[0] > 27: tag = 'pcb'
    elif role == 'devkit' and near(s[0], 18) and near(s[2], 25.5): tag = 'module'
    elif role == 'shield' and s[0] > 15: tag = 'shield'
    elif role == 'smd' and near(s[0], 3.5) and near(s[2], 3.5): tag = 'soc'
    elif role == 'devkit' and near(s[0], 2.5) and s[2] > 37: tag = 'header'
    elif role == 'shield' and near(s[1], 11.4): tag = 'pin'
    elif near(s[0], 7.9) or near(s[0], 6.9): tag = 'usb'
    elif near(s[0], 2.75) or near(s[0], 2.9): tag = 'btn'
    elif role == 'devkit' and near(s[0], 5.0) and near(s[2], 5.0): tag = 'uart'
    pc['tag'] = tag

# ------------------------------------------------------------ piece encoding
chunks = []; offset = 0
def push(arr):
    global offset
    b = arr.tobytes(); pad = (-len(b)) % 4
    chunks.append(b + b'\0' * pad)
    o = offset; offset += len(b) + pad
    return o

COS = math.cos(math.radians(32))
def feature_edges(v, t):
    key = np.round(v / 1e-3).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
    rep = np.zeros(inv.max() + 1, np.int64); rep[inv[::-1]] = np.arange(len(inv))[::-1]
    mt = inv[t]
    nrm = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    ln = np.linalg.norm(nrm, axis=1); good = ln > 1e-12
    nrm[good] /= ln[good, None]
    e = np.concatenate([mt[:, [0, 1]], mt[:, [1, 2]], mt[:, [2, 0]]])
    fid = np.tile(np.arange(len(t)), 3)
    keep = e[:, 0] != e[:, 1]
    e, fid = np.sort(e[keep], 1), fid[keep]
    k = e[:, 0] * (inv.max() + 1) + e[:, 1]
    o = np.argsort(k, kind='stable'); k, e, fid = k[o], e[o], fid[o]
    starts = np.r_[0, np.nonzero(np.diff(k))[0] + 1]; counts = np.diff(np.r_[starts, len(k)])
    feat = counts != 2
    two = np.nonzero(counts == 2)[0]
    f1, f2 = fid[starts[two]], fid[starts[two] + 1]
    ok = good[f1] & good[f2]
    d = np.einsum('ij,ij->i', nrm[f1], nrm[f2])
    feat[two[ok & (d < COS)]] = True
    sel = e[starts[feat]]
    return rep[sel]

def encode(pc, edges=True):
    used = np.unique(pc['tris'])
    remap = np.full(pc['pos'].shape[0], -1, np.int64); remap[used] = np.arange(len(used))
    v = pc['pos'][used]; t = remap[pc['tris']]
    mn, mx = v.min(0), v.max(0); span = np.maximum(mx - mn, 1e-6)
    q = np.round((v - mn) / span * 65535).astype(np.uint16)
    big = len(v) > 65535
    it = (np.uint32 if big else np.uint16)
    rec = dict(vc=int(len(v)), tc=int(len(t)), min=[round(x, 4) for x in mn], max=[round(x, 4) for x in mx],
               p=push(q.ravel()), i=push(t.ravel().astype(it)), i32=bool(big))
    if edges:
        ed = feature_edges(v, t)
        rec['ec'] = int(len(ed)); rec['e'] = push(ed.ravel().astype(it))
    else:
        rec['ec'] = 0
    return rec

def piece_rec(pc, edges=True):
    r = encode(pc, edges); r['m'] = pc.get('role') or ROLE[pc['prim']]
    if pc.get('tag'): r['tag'] = pc['tag']
    return r

manifest = dict(units='mm', materials=mats, parts=[])

# enclosure
for name, path, label, blurb in [
        ('FRAME', FRAME_GLB, 'Bezel frame', 'Rings the board edge and carries the key loop. 55.9 × 106.9 mm, 2.4 mm tall.'),
        ('TRAY', TRAY_GLB, 'Enclosure tray', 'The shell under the board, 18.0 mm deep with chamfered corners.')]:
    m = trimesh.load(path).to_geometry()
    pc = dict(prim=-1, role='enclosure', pos=step_to_scene(np.asarray(m.vertices)), tris=np.asarray(m.faces, np.int64))
    manifest['parts'].append(dict(id=name, name=label, kind='enclosure', blurb=blurb, pieces=[piece_rec(pc)]))

# board layers
LAYERS = [(23, 'SILK', 'Silkscreen', 'White ink: reference designators and the outline of every part.'),
          (24, 'MASK_T', 'Top solder mask', 'Black solder mask. Keeps solder on the pads and off the traces.'),
          (20, 'CU', 'Copper', 'Front copper: traces and pads, under the solder mask.'),
          (26, 'CORE', 'FR-4 core', 'Glass-epoxy laminate. 1.6 mm board, 50.4 × 91.0 mm.'),
          (25, 'MASK_B', 'Bottom solder mask', 'Black solder mask on the back side.')]
for pi, pid, label, blurb in LAYERS:
    pcs = [pc for pc in raw if pc['prim'] == pi]
    if pid == 'CU':
        pcs = [pc for pc in raw if pc['prim'] in (20, 21, 22)]
    manifest['parts'].append(dict(id=pid, name=label, kind='layer', blurb=blurb,
                                  pieces=[piece_rec(pc, edges=(pi != 23)) for pc in pcs]))

# components
for ref in REF:
    name, kind, blurb = INFO[ref]
    pcs = sorted(parts[ref], key=lambda pc: (pc['min'][1] + pc['max'][1]))
    manifest['parts'].append(dict(id=ref, name=name, kind=kind, blurb=blurb,
                                  pieces=[piece_rec(pc) for pc in pcs]))

# custom knobs and master cap (from envoy-knobs/knobs.py), placed on their shafts
KNOBS_DIR = sys.argv[5] if len(sys.argv) > 5 else None

def load_stl(path, crease=35.0):
    """Binary STL -> indexed mesh whose vertices are split at creases, so smooth shading keeps hard edges."""
    b = open(path, 'rb').read(); n = struct.unpack('<I', b[80:84])[0]
    tri = np.frombuffer(b[84:84 + n * 50], dtype=[('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])['v'].astype(np.float64)
    key = np.round(tri.reshape(-1, 3) / 1e-5).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
    pos = uniq * 1e-5; t = inv.reshape(-1, 3)
    fn = np.cross(pos[t[:, 1]] - pos[t[:, 0]], pos[t[:, 2]] - pos[t[:, 0]])
    fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    cos = math.cos(math.radians(crease))
    cv, cf = t.ravel(), np.repeat(np.arange(len(t)), 3)
    order = np.argsort(cv, kind='stable'); cv, cf = cv[order], cf[order]
    starts = np.r_[0, np.nonzero(np.diff(cv))[0] + 1, len(cv)]
    new_of_corner = np.empty(len(cv), np.int64); out_pos = []
    for s, e in zip(starts[:-1], starts[1:]):
        groups = []                                   # (representative normal, new index)
        for c in range(s, e):
            nrm = fn[cf[c]]
            for gi, (gn, idx) in enumerate(groups):
                if gn @ nrm > cos: new_of_corner[c] = idx; break
            else:
                idx = len(out_pos); out_pos.append(pos[cv[s]]); groups.append((nrm, idx)); new_of_corner[c] = idx
    corner_new = np.empty(len(cv), np.int64); corner_new[order] = new_of_corner
    return np.array(out_pos), corner_new.reshape(-1, 3)

if KNOBS_DIR:
    mats['knob'] = dict(color=[0.012, 0.012, 0.014], metal=0.0, rough=0.48)
    mats['knobTop'] = dict(color=[0.81, 0.57, 0.15], metal=1.0, rough=0.28)
    mats['cap'] = dict(color=[0.55, 0.012, 0.006], metal=0.0, rough=0.42)
    place = json.load(open(os.path.join(KNOBS_DIR, 'placement.json')))
    kb = load_stl(os.path.join(KNOBS_DIR, 'envoy-knob.stl'))
    ki = load_stl(os.path.join(KNOBS_DIR, 'envoy-knob-insert.stl'))
    cp = load_stl(os.path.join(KNOBS_DIR, 'envoy-master-cap.stl'))
    def placed(mesh, cx, cz, y0, role, tag):
        v, t = mesh
        pos = np.c_[cx + v[:, 0], y0 + v[:, 2], cz - v[:, 1]]      # Z-up print frame -> board frame
        return dict(prim=-1, role=role, pos=pos, tris=t, tag=tag)
    for kid, enc in [('K1', 'SW1'), ('K2', 'SW2'), ('K3', 'SW4')]:
        cx, cz = place['encoders'][enc]
        pcs = [placed(kb, cx, cz, place['knob_y0'], 'knob', 'body'),
               placed(ki, cx, cz, place['knob_y0'] + place['insert_z'], 'knobTop', 'insert')]
        manifest['parts'].append(dict(id=kid, name='Custom knob', kind='knob', on=enc,
            blurb='Printed knob, Ø13.6 × 20.3 mm, on ' + enc + ': fine grip band, smooth top band and a flush top disc with an indicator dash. D-bore with three crush ribs.',
            pieces=[piece_rec(pc) for pc in pcs]))
    cx, cz = place['tact']['SW3']
    manifest['parts'].append(dict(id='CAP', name='Master cap', kind='cap', on='SW3',
        blurb='Printed cap for the 12 mm switch: 12.0 mm flat-top square with the Envoy mark set in, press-fit on the 7 mm plunger.',
        pieces=[piece_rec(placed(cp, cx, cz, place['cap_y0'], 'cap', 'cap'))]))

data = b''.join(chunks)
print('bytes', len(data), 'parts', len(manifest['parts']),
      'pieces', sum(len(p['pieces']) for p in manifest['parts']),
      'tris', sum(pp['tc'] for p in manifest['parts'] for pp in p['pieces']),
      'edges', sum(pp['ec'] for p in manifest['parts'] for pp in p['pieces']))
for p in manifest['parts']:
    print(p['id'], p['name'], len(p['pieces']), sum(pp['tc'] for pp in p['pieces']), sum(pp['ec'] for pp in p['pieces']))
mj = json.dumps(manifest, separators=(',', ':')).encode()
mj += b' ' * ((-len(mj)) % 4)
blob = b'ENV1' + struct.pack('<I', len(mj)) + mj + data
open(OUT + '.bin', 'wb').write(blob)
with open(OUT + '.js', 'w', encoding='ascii') as fo:
    fo.write('/* ENVOY V1 parts (same bytes as envoy-model.bin), for opening index.html straight from disk. */' + chr(10))
    fo.write('window.ENVOY_MODEL_B64="' + base64.b64encode(blob).decode('ascii') + '";' + chr(10))
print('blob', len(blob), 'manifest', len(mj))
