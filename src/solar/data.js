// Physical and orbital data for the solar system.
//
// Every length is in KILOMETRES, every angle in DEGREES, every time in DAYS
// unless a name says otherwise. Nothing here is scaled, rounded for looks, or
// adjusted to make the render prettier -- that is the whole point of the app.
//
// Orbital elements are JPL's "Keplerian Elements for Approximate Positions of
// the Major Planets", valid 1800 AD - 2050 AD:
//   https://ssd.jpl.nasa.gov/planets/approx_pos.html
// Each planet carries elements at the J2000 epoch plus their rates of change
// per Julian century.

export const AU = 149597870.7;          // km
export const C_KM_S = 299792.458;       // speed of light, km/s
export const J2000 = 2451545.0;         // Julian date of the J2000.0 epoch

// Solar irradiance at 1 AU, W/m^2 -- used for the HUD readout only, never to
// dim the render (see render/material.js for why).
export const SOLAR_CONSTANT = 1361;

// --- Orbital elements -------------------------------------------------------
// [a (AU), e, I (deg), L (deg), longPeri (deg), longNode (deg)]
// followed by the same six as per-century rates.
const ELEMENTS = {
  mercury: {
    epoch: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    rate:  [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  },
  venus: {
    epoch: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    rate:  [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  },
  // JPL tabulates the Earth-Moon barycentre; at these scales the ~4700 km
  // offset to Earth's own centre is far below anything you can see.
  earth: {
    epoch: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    rate:  [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  },
  mars: {
    epoch: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    rate:  [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  },
  jupiter: {
    epoch: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    rate:  [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  },
  saturn: {
    epoch: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    rate:  [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  },
  uranus: {
    epoch: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
    rate:  [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  },
  neptune: {
    epoch: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    rate:  [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  },
  pluto: {
    epoch: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    rate:  [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  },
};

// --- Bodies -----------------------------------------------------------------
// radius        : equatorial radius, km
// polarRadius   : optional; drives the visible oblateness of the giants
// tilt          : IAU axial obliquity to the ecliptic, deg. Values above 90
//                 encode retrograde spin (Venus, Uranus, Pluto), so rotation
//                 periods below are always positive magnitudes.
// rotationHours : sidereal rotation period, hours
// mass          : kg, for the HUD only


// --- Atmospheres ------------------------------------------------------------
// What a world's air does to its own edge. `height` is the visible shell as a
// fraction of the radius -- generous compared to the scale height, because what
// you actually see at a limb is the whole slant path through a thinning haze --
// and `density` is how strongly it scatters.
//
// Colours are what the gas does to sunlight: Rayleigh blue for Earth's thin
// clear air, sulphuric cream for Venus, a rusty smear for Mars's thin dust,
// orange for Titan's photochemical smog, and methane cyan-to-blue for the ice
// giants.

const ATMOSPHERE = {
  earth:   { color: '#6ea8ff', height: 0.028, density: 1.00 },
  venus:   { color: '#f6e3b0', height: 0.045, density: 1.70 },
  mars:    { color: '#d9a583', height: 0.014, density: 0.28 },
  jupiter: { color: '#dccfb4', height: 0.022, density: 0.60 },
  saturn:  { color: '#ecdfbe', height: 0.024, density: 0.50 },
  uranus:  { color: '#a6e2e8', height: 0.028, density: 0.70 },
  neptune: { color: '#7aa6f5', height: 0.028, density: 0.75 },
  pluto:   { color: '#cdbaa8', height: 0.020, density: 0.14 },
  titan:   { color: '#eba54c', height: 0.070, density: 1.60 },
};

export const SUN = {
  id: 'sun',
  name: 'Sun',
  radius: 695700,
  tilt: 7.25,
  rotationHours: 609.12,          // 25.38 d sidereal
  mass: 1.98892e30,
  shader: 'sun',
  color: '#fff3d4',
  map: 'assets/textures/2k_sun.jpg',
};

export const PLANETS = [
  {
    id: 'mercury', name: 'Mercury', radius: 2439.7, tilt: 0.034,
    rotationHours: 1407.6, mass: 3.301e23, elements: ELEMENTS.mercury,
    shader: 'rocky', color: '#8c8681',
    map: 'assets/textures/mercury.jpg',
    note: 'Cratered, airless, and locked in a 3:2 spin-orbit resonance.',
  },
  {
    id: 'venus', name: 'Venus', radius: 6051.8, tilt: 177.36,
    rotationHours: 5832.6, mass: 4.867e24, elements: ELEMENTS.venus,
    shader: 'venus', color: '#e8cda2',
    // The CLOUD deck, not the surface. Venus's surface has never been seen in
    // visible light from outside; a radar map would be a picture of something
    // no eye could witness from here.
    map: 'assets/textures/2k_venus_atmosphere.jpg',
    note: 'Its day is longer than its year, and it spins backwards.',
    atmosphere: ATMOSPHERE.venus,
  },
  {
    id: 'earth', name: 'Earth', radius: 6378.137, polarRadius: 6356.752,
    tilt: 23.44, rotationHours: 23.9345, mass: 5.972e24, elements: ELEMENTS.earth,
    shader: 'earth', color: '#2a6ba8',
    map: 'assets/textures/2k_earth_daymap.jpg',
    cloudMap: 'assets/textures/2k_earth_clouds.jpg',
    note: 'One ten-thousandth of a degree wide seen from Neptune.',
    atmosphere: ATMOSPHERE.earth,
  },
  {
    id: 'mars', name: 'Mars', radius: 3396.2, polarRadius: 3376.2, tilt: 25.19,
    rotationHours: 24.6229, mass: 6.417e23, elements: ELEMENTS.mars,
    shader: 'mars', color: '#b5502a',
    map: 'assets/textures/mars.jpg',
    note: 'Half of Earth’s diameter; a day just 40 minutes longer.',
    atmosphere: ATMOSPHERE.mars,
  },
  {
    id: 'jupiter', name: 'Jupiter', radius: 71492, polarRadius: 66854, tilt: 3.13,
    rotationHours: 9.925, mass: 1.898e27, elements: ELEMENTS.jupiter,
    shader: 'jupiter', color: '#d8ca9d',
    // A real photographic map. Equirectangular 4096x2048; the procedural
    // banding stays as the fallback if it cannot be loaded. See CREDITS.
    map: 'assets/textures/jupiter.jpg',
    note: 'More than twice the mass of every other planet combined.',
    atmosphere: ATMOSPHERE.jupiter,
  },
  {
    id: 'saturn', name: 'Saturn', radius: 60268, polarRadius: 54364, tilt: 26.73,
    rotationHours: 10.656, mass: 5.683e26, elements: ELEMENTS.saturn,
    shader: 'saturn', color: '#e3d8b0', rings: true,
    note: 'The rings span 140,000 km but are only tens of metres thick.',
    atmosphere: ATMOSPHERE.saturn,
  },
  {
    id: 'uranus', name: 'Uranus', radius: 25559, polarRadius: 24973, tilt: 97.77,
    rotationHours: 17.24, mass: 8.681e25, elements: ELEMENTS.uranus,
    shader: 'iceGiant', color: '#a8dcdf',
    note: 'Tipped on its side, so it rolls along its orbit.',
    atmosphere: ATMOSPHERE.uranus,
  },
  {
    id: 'neptune', name: 'Neptune', radius: 24764, polarRadius: 24341, tilt: 28.32,
    rotationHours: 16.11, mass: 1.024e26, elements: ELEMENTS.neptune,
    shader: 'iceGiant', color: '#3d5ef0',
    note: 'Sunlight takes four hours to get here.',
    atmosphere: ATMOSPHERE.neptune,
  },
  {
    id: 'pluto', name: 'Pluto', radius: 1188.3, tilt: 122.53,
    rotationHours: 153.3, mass: 1.303e22, elements: ELEMENTS.pluto,
    shader: 'rocky', color: '#bfa98e',
    note: 'Smaller than the Moon, and its orbit crosses Neptune’s.',
    atmosphere: ATMOSPHERE.pluto,
  },
];

// --- Moons ------------------------------------------------------------------
// Moon orbits are Keplerian about their parent. `frame` says which plane the
// inclination is measured from: nearly every moon orbits in its parent's
// EQUATORIAL plane (so Titan follows Saturn's 26.7 degree tilt and the ring
// plane, which is very visible), while our own Moon is conventionally given
// against the ECLIPTIC.
//
// a: km, e: -, i: deg, period: days, node/peri/m0: deg at the epoch (J2000
// unless the entry says otherwise). Moons other than our own use fixed elements
// and a mean anomaly stepped by their orbital period, which is well inside what
// you can perceive when the whole system is on screen.

export const MOONS = [
  // The Moon gets more care than the rest, because the Earth-Moon gap is the
  // single most misrepresented distance in the solar system and the one this
  // app most wants to get right.
  //
  // Its mean anomaly advances at the ANOMALISTIC rate (27.5546 d, perigee to
  // perigee), not the sidereal one, while the node regresses over 18.6 years
  // and the perigee advances over 8.85 -- so all three carry their own rates.
  // `perturb` then adds the main solar perturbation terms; without them a pure
  // ellipse can only ever reach a(1-e) = 363,300 km, and the real perigee of
  // 356,500 km is unreachable. Elements are Schlyter's, epoch JD 2451543.5.
  {
    id: 'moon', name: 'Moon', parent: 'earth', radius: 1737.4,
    a: 384400, e: 0.054900, i: 5.1454, frame: 'ecliptic',
    period: 27.321661,
    epoch: 2451543.5,
    node: 125.1228, nodeRate: -0.0529538083,
    peri: 318.0634, periRate: 0.1643573223,
    m0: 115.3654, mRate: 13.0649929509,
    perturb: 'lunar',
    tilt: 6.68, color: '#9a9a96', shader: 'moon',
    note: '30 Earth-diameters away — the gap almost every diagram shrinks.',
  },
  {
    id: 'phobos', name: 'Phobos', parent: 'mars', radius: 11.27,
    a: 9376, e: 0.0151, i: 1.093, frame: 'equatorial',
    period: 0.318910, node: 0, peri: 0, m0: 0,
    color: '#8a7d70', shader: 'rocky',
    note: 'Orbits faster than Mars rotates; rises in the west.',
  },
  {
    id: 'deimos', name: 'Deimos', parent: 'mars', radius: 6.2,
    a: 23463, e: 0.00033, i: 0.93, frame: 'equatorial',
    period: 1.263, node: 0, peri: 0, m0: 180,
    color: '#9a8d80', shader: 'rocky',
  },
  {
    id: 'io', name: 'Io', parent: 'jupiter', radius: 1821.6,
    a: 421700, e: 0.0041, i: 0.05, frame: 'equatorial',
    period: 1.769138, node: 0, peri: 0, m0: 342.0,
    color: '#d6c85a', shader: 'io',
    note: 'The most volcanically active body in the solar system.',
  },
  {
    id: 'europa', name: 'Europa', parent: 'jupiter', radius: 1560.8,
    a: 671034, e: 0.0094, i: 0.47, frame: 'equatorial',
    period: 3.551181, node: 0, peri: 0, m0: 171.0,
    color: '#d8d0c0', shader: 'moon',
    note: 'A saltwater ocean under a shell of cracked ice.',
  },
  {
    id: 'ganymede', name: 'Ganymede', parent: 'jupiter', radius: 2634.1,
    a: 1070412, e: 0.0013, i: 0.20, frame: 'equatorial',
    period: 7.154553, node: 0, peri: 0, m0: 317.0,
    color: '#8c8378', shader: 'moon',
    note: 'Bigger than Mercury — the largest moon there is.',
  },
  {
    id: 'callisto', name: 'Callisto', parent: 'jupiter', radius: 2410.3,
    a: 1882709, e: 0.0074, i: 0.192, frame: 'equatorial',
    period: 16.689018, node: 0, peri: 0, m0: 181.0,
    color: '#6b5f56', shader: 'moon',
  },
  {
    id: 'enceladus', name: 'Enceladus', parent: 'saturn', radius: 252.1,
    a: 237948, e: 0.0047, i: 0.009, frame: 'equatorial',
    period: 1.370218, node: 0, peri: 0, m0: 57.0,
    color: '#f0f4f5', shader: 'moon',
    map: 'assets/textures/enceladus.jpg',
    note: 'Whiter than fresh snow; vents water into Saturn’s E ring.',
  },
  {
    id: 'mimas', name: 'Mimas', parent: 'saturn', radius: 198.2,
    a: 185539, e: 0.0196, i: 1.574, frame: 'equatorial',
    period: 0.942422, node: 0, peri: 0, m0: 14.0,
    color: '#b9b6b0', shader: 'moon',
    map: 'assets/textures/mimas.jpg',
    note: 'Herschel crater spans a third of its width — it nearly broke it apart.',
  },
  {
    id: 'titan', name: 'Titan', parent: 'saturn', radius: 2574.7,
    a: 1221870, e: 0.0288, i: 0.348, frame: 'equatorial',
    period: 15.945, node: 0, peri: 0, m0: 163.0,
    color: '#e0a94a', shader: 'titan',
    note: 'A thick nitrogen atmosphere and lakes of liquid methane.',
    atmosphere: ATMOSPHERE.titan,
  },
  {
    id: 'miranda', name: 'Miranda', parent: 'uranus', radius: 235.8,
    a: 129390, e: 0.0013, i: 4.232, frame: 'equatorial',
    period: 1.413479, node: 0, peri: 0, m0: 200.0,
    color: '#a9a49e', shader: 'moon',
    map: 'assets/textures/miranda.jpg',
    note: 'Cliffs 20 km high — the tallest known anywhere.',
  },
  {
    id: 'triton', name: 'Triton', parent: 'neptune', radius: 1353.4,
    a: 354759, e: 0.000016, i: 156.885, frame: 'equatorial',
    period: 5.876854, node: 0, peri: 0, m0: 0,
    color: '#c8bdb8', shader: 'moon',
    note: 'Orbits backwards — a captured Kuiper belt object.',
  },
  {
    id: 'charon', name: 'Charon', parent: 'pluto', radius: 606.0,
    a: 19591, e: 0.0002, i: 0.08, frame: 'equatorial',
    period: 6.3872, node: 0, peri: 0, m0: 0,
    color: '#a89c92', shader: 'moon',
    note: 'So large that it and Pluto orbit a point in empty space.',
  },
];

// Saturn's rings, in km from Saturn's centre. The Cassini division is a real
// gap, not a shading trick.
export const SATURN_RINGS = {
  inner: 74500,
  outer: 140220,
  cassini: [117580, 122170],
};


// --- Minor planets ----------------------------------------------------------
// The four largest objects in the asteroid belt, promoted out of the point
// cloud into real bodies you can fly to. Ceres alone holds about a quarter of
// the belt's entire mass, and is round enough to be a dwarf planet.
//
// Elements are osculating values from JPL's Small-Body Database at
// ASTEROID_EPOCH (see asteroids.js), so they use the same single-epoch form as
// the moons rather than the planets' epoch-plus-rates form. Mean anomaly
// advances at the Gaussian rate n = 0.9856076686 / a^1.5 degrees per day.

const MP_EPOCH = 2461200.5;

function meanMotion(aAU) {
  return 0.9856076686 / (aAU * Math.sqrt(aAU));
}

function minorPlanet({ id, name, aAU, e, i, node, peri, m0, diameter,
                       rotationHours, color, note }) {
  return {
    id, name, radius: diameter / 2, e, i, node, peri, m0,
    a: aAU * AU,
    aAU,
    epoch: MP_EPOCH,
    mRate: meanMotion(aAU),
    frame: 'ecliptic',
    rotationHours,
    tilt: 0,
    shader: 'rocky',
    color,
    note,
  };
}

export const MINOR_PLANETS = [
  minorPlanet({
    id: 'ceres', name: 'Ceres', aAU: 2.765552595034094, e: 0.07969229514816586,
    i: 10.58802780183462, node: 80.24862682043221, peri: 73.29421453021587,
    m0: 274.4193463761342, diameter: 939.4, rotationHours: 9.074170,
    color: '#8f8880',
    note: 'A dwarf planet, and a quarter of the belt’s mass on its own.',
  }),
  minorPlanet({
    id: 'vesta', name: 'Vesta', aAU: 2.361365965127599, e: 0.09020374382834395,
    i: 7.143925545058711, node: 103.701293265032, peri: 151.4686478221564,
    m0: 81.19015607686903, diameter: 522.77, rotationHours: 5.3421276322,
    color: '#b6ac96',
    note: 'Bright enough to see with the naked eye, just.',
  }),
  minorPlanet({
    id: 'pallas', name: 'Pallas', aAU: 2.769559010737709, e: 0.2307000995648547,
    i: 34.93279321851542, node: 172.8866193357694, peri: 310.9699161652136,
    m0: 254.2496521742734, diameter: 513, rotationHours: 7.8132214,
    color: '#8a8a84',
    note: 'Tilted 35° out of the ecliptic — it crosses the belt at an angle.',
  }),
  minorPlanet({
    id: 'hygiea', name: 'Hygiea', aAU: 3.150974033963701, e: 0.1067092741240963,
    i: 3.829529946447122, node: 283.1198927508594, peri: 312.4242387344704,
    m0: 252.0344242359649, diameter: 407.12, rotationHours: 13.828,
    color: '#6f6a63',
    note: 'Dark and carbon-rich, out at the belt’s far edge.',
  }),
];

// --- Craft -----------------------------------------------------------------
// Things that are not worlds. Each carries its own way of being placed, because
// they are not all in orbit around anything: the station keeps a Keplerian
// ellipse about Earth, the telescope hangs at a point where three gravities
// balance and nothing orbits at all.

export const ISS = {
  id: 'iss',
  name: 'ISS',
  parent: 'earth',
  kind: 'orbiter',
  radius: 0.0545,                 // km — half of 109 m, for the marker and camera
  a: 6791,                        // ~413 km above the equator
  e: 0.0003,
  i: 51.64,                       // the inclination that lets Baikonur reach it
  frame: 'equatorial',
  period: 0.0645,                 // 92.9 minutes
  node: 0,
  nodeRate: -4.97,                // J2 makes the orbit plane regress ~5°/day
  peri: 0,
  m0: 0,
  color: '#cfd6de',
  note: '109 m across, 413 km up, going round once every 93 minutes.',
  model: 'assets/iss/scene.gltf',
  modelSpan: 0.109,               // km: scale the model so its longest axis is this
};

// The Sun–Earth L2 point, as a fraction of Earth's heliocentric distance.
//
// Solved from the collinear condition -- the point beyond Earth where the Sun's
// pull, Earth's pull and the centripetal requirement of going round once a year
// all balance:
//
//     GM_sun/(R+d)² + GM_earth/d² = ω²(R+d),   ω² = G(M_sun+M_earth)/R³
//
// The familiar first-order answer, R·(M_earth/3M_sun)^⅓, is 0.33% short, so the
// solved value is used. It works out at 1,501,481 km beyond Earth -- very nearly
// four times as far away as the Moon.
export const L2_FRACTION = 0.01003683;

export const JWST = {
  id: 'jwst',
  name: 'James Webb',
  parent: 'earth',
  kind: 'lagrange',
  radius: 0.0106,                 // km — half of the 21.2 m sunshield
  color: '#d8b26a',
  note: 'At L2, 1.5 million km out — four times further than the Moon.',
  model: 'assets/james-web/scene.gltf',
  modelSpan: 0.0212,              // the sunshield is 21.2 m long
  // A halo about L2. This is a kinematic stand-in, not an integrated three-body
  // trajectory: the real path is quasi-periodic and needs station-keeping burns
  // every few weeks. The size and period are the real ones, so it sweeps the
  // right volume of space at the right rate and never enters Earth's shadow --
  // which is the whole point of a halo rather than sitting still at L2.
  halo: {
    alongAxis: 2.6e5,             // km, toward and away from the Sun
    inPlane: 8.2e5,               // km, along Earth's direction of travel
    outOfPlane: 3.9e5,            // km, above and below the ecliptic
    period: 177.8,                // days
    phase: 1.9,                   // radians, so it is somewhere plausible now
  },
};

export const CRAFT = [ISS, JWST];


