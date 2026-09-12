import { DynamicObject, DynamicShapeType } from './types';

export interface StructureParams {
  type: 
    | 'temple' 
    | 'castle' 
    | 'pagoda' 
    | 'tower' 
    | 'pyramid' 
    | 'bridge' 
    | 'monolith' 
    | 'portal' 
    | 'modern_villa' 
    | 'henge' 
    | 'custom';
  style?: 'ancient' | 'futuristic' | 'minimalist' | 'cyberpunk' | 'stone' | 'golden' | 'mystical' | string;
  position?: [number, number, number];
  scale?: number | [number, number, number];
  primaryColor?: [number, number, number];
  secondaryColor?: [number, number, number];
  emissiveColor?: [number, number, number];
  roughness?: number;
  metallic?: number;
  environment?: 'meadow' | 'courtyard' | 'desert' | 'water' | 'void' | 'alien' | string;
  clearBaseCottage?: boolean;
  replaceExisting?: boolean;
}

/**
 * Procedural 3D Structure Generator
 * Translates high-level natural language architectural requests into
 * perfectly proportioned, mathematically symmetrical sets of PBR primitives.
 */
export function generateStructure(params: StructureParams): DynamicObject[] {
  const type = (params.type || 'temple').toLowerCase();
  const [posX, posY, posZ] = params.position || [0, 0, 0];
  
  const scaleArr: [number, number, number] = Array.isArray(params.scale)
    ? params.scale
    : typeof params.scale === 'number'
      ? [params.scale, params.scale, params.scale]
      : [1.0, 1.0, 1.0];
  const [sX, sY, sZ] = scaleArr;

  const pCol = params.primaryColor || [0.88, 0.84, 0.78];
  const sCol = params.secondaryColor || [0.95, 0.75, 0.25];
  const eCol = params.emissiveColor || [1.5, 1.2, 0.6];
  const rough = params.roughness ?? 0.35;
  const metal = params.metallic ?? 0.15;

  const objects: DynamicObject[] = [];

  const add = (
    shape: DynamicShapeType,
    offset: [number, number, number],
    size: [number, number, number],
    color: [number, number, number],
    options: {
      roughness?: number;
      metallic?: number;
      emissive?: [number, number, number];
      label?: string;
    } = {}
  ) => {
    objects.push({
      shape,
      position: [
        posX + offset[0] * sX,
        posY + offset[1] * sY,
        posZ + offset[2] * sZ,
      ],
      size: [size[0] * sX, size[1] * sY, size[2] * sZ],
      color,
      roughness: options.roughness ?? rough,
      metallic: options.metallic ?? metal,
      emissive: options.emissive,
      label: options.label,
    });
  };

  switch (type) {
    case 'temple': {
      // Classical Greco-Roman Parthenon Temple
      // 1. Stepped Stylobate Podium (3 tiers)
      add('box', [0, 0.15, 0], [4.6, 0.15, 6.2], pCol, { roughness: 0.5, label: 'Podium Base Tier 1' });
      add('box', [0, 0.40, 0], [4.2, 0.12, 5.8], pCol, { roughness: 0.45, label: 'Podium Base Tier 2' });
      add('box', [0, 0.62, 0], [3.8, 0.10, 5.4], pCol, { roughness: 0.4, label: 'Podium Base Tier 3' });

      // 2. Colonnade (Perimeter fluted columns)
      const colHeight = 2.4;
      const colRadius = 0.22;
      const colY = 0.72 + colHeight * 0.5;

      // Front & back columns
      const xCols = [-3.2, -1.92, -0.64, 0.64, 1.92, 3.2];
      const zCols = [-4.6, 4.6];

      for (const z of zCols) {
        for (const x of xCols) {
          add('cylinder', [x * 0.5, colY, z * 0.5], [colRadius, colHeight * 0.5, colRadius], pCol, {
            roughness: 0.25,
            label: `Temple Column (${x > 0 ? 'R' : 'L'})`,
          });
          // Capital & Base
          add('box', [x * 0.5, 0.75, z * 0.5], [colRadius * 1.4, 0.08, colRadius * 1.4], pCol, { roughness: 0.3 });
          add('box', [x * 0.5, 0.72 + colHeight, z * 0.5], [colRadius * 1.5, 0.09, colRadius * 1.5], pCol, { roughness: 0.3 });
        }
      }

      // Side flank columns
      const sideZ = [-3.0, -1.5, 0, 1.5, 3.0];
      for (const z of sideZ) {
        for (const x of [-3.2, 3.2]) {
          add('cylinder', [x * 0.5, colY, z * 0.5], [colRadius, colHeight * 0.5, colRadius], pCol, {
            roughness: 0.25,
            label: 'Flank Column',
          });
          add('box', [x * 0.5, 0.75, z * 0.5], [colRadius * 1.4, 0.08, colRadius * 1.4], pCol, { roughness: 0.3 });
          add('box', [x * 0.5, 0.72 + colHeight, z * 0.5], [colRadius * 1.5, 0.09, colRadius * 1.5], pCol, { roughness: 0.3 });
        }
      }

      // 3. Inner Cella Sanctum Walls
      add('box', [0, colY, 0], [1.1, colHeight * 0.5, 1.8], pCol, { roughness: 0.4, label: 'Inner Cella' });

      // 4. Entablature & Architrave Beam
      const beamY = 0.72 + colHeight + 0.18;
      add('box', [0, beamY, 0], [3.9, 0.18, 5.5], pCol, { roughness: 0.35, label: 'Architrave Beam' });

      // 5. Pediments (Triangular Gables front & back)
      add('cone', [0, beamY + 0.55, 2.5], [2.1, 0.7, 0.15], sCol, { roughness: 0.3, label: 'Front Pediment' });
      add('cone', [0, beamY + 0.55, -2.5], [2.1, 0.7, 0.15], sCol, { roughness: 0.3, label: 'Rear Pediment' });

      // 6. Roof Slab
      add('box', [0, beamY + 0.55, 0], [1.9, 0.12, 5.2], sCol, { roughness: 0.4, label: 'Temple Roof' });

      // 7. Golden Eternal Brazier in the Front Portico
      add('cylinder', [0, 0.95, 1.6], [0.35, 0.25, 0.35], [0.25, 0.25, 0.28], { roughness: 0.3, metallic: 0.8, label: 'Brazier Base' });
      add('sphere', [0, 1.35, 1.6], [0.28, 0.35, 0.28], eCol, {
        emissive: eCol,
        roughness: 0.1,
        label: 'Eternal Sacred Flame',
      });
      break;
    }

    case 'pagoda': {
      // Traditional Multi-Tiered East Asian Pagoda
      // Foundation Base
      add('box', [0, 0.25, 0], [3.2, 0.25, 3.2], [0.45, 0.45, 0.45], { roughness: 0.6, label: 'Stone Foundation' });
      
      const tiers = 3;
      let currentY = 0.5;
      const baseWidth = 2.4;

      for (let i = 0; i < tiers; i++) {
        const factor = 1.0 - i * 0.22;
        const w = baseWidth * factor;
        const bodyH = 0.95;

        // Core Pavilion Chamber
        add('box', [0, currentY + bodyH * 0.5, 0], [w * 0.8, bodyH * 0.5, w * 0.8], pCol, {
          roughness: 0.4,
          label: `Pagoda Tier ${i + 1} Chamber`,
        });

        // Corner Vermilion Pillars
        const pOffset = w * 0.78;
        add('cylinder', [-pOffset, currentY + bodyH * 0.5, -pOffset], [0.12, bodyH * 0.5, 0.12], [0.85, 0.18, 0.15], { roughness: 0.3 });
        add('cylinder', [pOffset, currentY + bodyH * 0.5, -pOffset], [0.12, bodyH * 0.5, 0.12], [0.85, 0.18, 0.15], { roughness: 0.3 });
        add('cylinder', [-pOffset, currentY + bodyH * 0.5, pOffset], [0.12, bodyH * 0.5, 0.12], [0.85, 0.18, 0.15], { roughness: 0.3 });
        add('cylinder', [pOffset, currentY + bodyH * 0.5, pOffset], [0.12, bodyH * 0.5, 0.12], [0.85, 0.18, 0.15], { roughness: 0.3 });

        // Flared Overhanging Roof Eaves
        const roofY = currentY + bodyH + 0.15;
        add('box', [0, roofY, 0], [w * 1.35, 0.12, w * 1.35], sCol, { roughness: 0.35, label: `Tier ${i + 1} Eaves` });
        add('cone', [0, roofY + 0.25, 0], [w * 1.4, 0.35, w * 1.4], sCol, { roughness: 0.35 });

        // Hanging Paper Lanterns on Eaves
        add('lantern', [-w * 1.25, roofY - 0.2, 0], [0.15, 0.22, 0.15], [1.0, 0.35, 0.2], {
          emissive: [2.0, 0.8, 0.4],
          label: 'Eave Lantern',
        });
        add('lantern', [w * 1.25, roofY - 0.2, 0], [0.15, 0.22, 0.15], [1.0, 0.35, 0.2], {
          emissive: [2.0, 0.8, 0.4],
          label: 'Eave Lantern',
        });

        currentY = roofY + 0.4;
      }

      // Golden Sacred Spire (Sorin Finial)
      add('cylinder', [0, currentY + 0.8, 0], [0.08, 0.8, 0.08], [0.95, 0.8, 0.2], { metallic: 0.9, roughness: 0.1, label: 'Spire Mast' });
      add('torus', [0, currentY + 0.4, 0], [0.28, 0.06, 0.28], [0.95, 0.8, 0.2], { metallic: 0.9, roughness: 0.1 });
      add('torus', [0, currentY + 0.7, 0], [0.22, 0.05, 0.22], [0.95, 0.8, 0.2], { metallic: 0.9, roughness: 0.1 });
      add('crystal', [0, currentY + 1.6, 0], [0.18, 0.32, 0.18], eCol, { emissive: eCol, label: 'Spire Jewel' });
      break;
    }

    case 'castle': {
      // Medieval Stone Fortress / Citadel
      // Central Keep
      add('box', [0, 1.8, 0], [2.2, 1.8, 2.2], pCol, { roughness: 0.65, label: 'Central Keep' });
      // Keep Parapet / Crenellations
      add('box', [0, 3.7, 0], [2.4, 0.2, 2.4], pCol, { roughness: 0.6, label: 'Keep Parapet' });

      // 4 Corner Towers with Conical Roofs
      const towerDist = 2.4;
      const towerH = 2.4;
      const towerCorners: [number, number][] = [
        [-towerDist, -towerDist],
        [towerDist, -towerDist],
        [-towerDist, towerDist],
        [towerDist, towerDist],
      ];

      for (const [cx, cz] of towerCorners) {
        add('cylinder', [cx, towerH, cz], [0.75, towerH, 0.75], pCol, { roughness: 0.6, label: 'Corner Turret' });
        // Turret Roof
        add('cone', [cx, towerH * 2 + 0.7, cz], [0.95, 1.4, 0.95], sCol, { roughness: 0.4, label: 'Turret Conical Roof' });
      }

      // Curtain Walls
      add('box', [0, 1.2, -towerDist], [towerDist, 1.2, 0.35], pCol, { roughness: 0.65, label: 'North Wall' });
      add('box', [-towerDist, 1.2, 0], [0.35, 1.2, towerDist], pCol, { roughness: 0.65, label: 'West Wall' });
      add('box', [towerDist, 1.2, 0], [0.35, 1.2, towerDist], pCol, { roughness: 0.65, label: 'East Wall' });

      // Gatehouse Front Wall with Archway
      add('box', [-1.6, 1.2, towerDist], [0.8, 1.2, 0.4], pCol, { roughness: 0.65, label: 'Gate Left Wall' });
      add('box', [1.6, 1.2, towerDist], [0.8, 1.2, 0.4], pCol, { roughness: 0.65, label: 'Gate Right Wall' });
      add('box', [0, 2.0, towerDist], [1.2, 0.4, 0.4], pCol, { roughness: 0.65, label: 'Gate Arch Header' });

      // Glowing Wall Torches
      add('lantern', [-0.9, 1.5, towerDist + 0.3], [0.12, 0.2, 0.12], [0.95, 0.6, 0.2], {
        emissive: [2.2, 1.2, 0.4],
        label: 'Gate Torch L',
      });
      add('lantern', [0.9, 1.5, towerDist + 0.3], [0.12, 0.2, 0.12], [0.95, 0.6, 0.2], {
        emissive: [2.2, 1.2, 0.4],
        label: 'Gate Torch R',
      });
      break;
    }

    case 'monolith': {
      // Cyberpunk / Sci-Fi Megalith & Energy Nexus
      // Central Obelisk
      add('box', [0, 3.2, 0], [0.55, 3.2, 0.55], [0.08, 0.08, 0.12], {
        roughness: 0.1,
        metallic: 0.85,
        label: 'Obsidian Monolith Core',
      });

      // Floating Emissive Energy Rings
      add('torus', [0, 1.8, 0], [1.4, 0.10, 1.4], eCol, { emissive: eCol, roughness: 0.1, metallic: 0.5, label: 'Primary Energy Ring' });
      add('torus', [0, 3.6, 0], [1.0, 0.08, 1.0], sCol, { emissive: sCol, roughness: 0.1, metallic: 0.5, label: 'Secondary Ring' });
      add('torus', [0, 5.2, 0], [0.65, 0.06, 0.65], eCol, { emissive: eCol, roughness: 0.1, metallic: 0.5, label: 'Tertiary Ring' });

      // Levitating Orbiting Crystalline Shards
      const shardRadius = 2.2;
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        const sx = Math.cos(angle) * shardRadius;
        const sz = Math.sin(angle) * shardRadius;
        add('crystal', [sx, 2.8 + (i % 2) * 0.6, sz], [0.25, 0.55, 0.25], sCol, {
          emissive: [sCol[0] * 1.5, sCol[1] * 1.5, sCol[2] * 1.5],
          roughness: 0.1,
          metallic: 0.3,
          label: `Levitating Shard #${i + 1}`,
        });
      }

      // Base Energy Conduit Platform
      add('box', [0, 0.1, 0], [3.4, 0.1, 3.4], [0.12, 0.12, 0.16], { roughness: 0.3, metallic: 0.6, label: 'Conduit Dias' });
      break;
    }

    case 'portal': {
      // Ancient Gateway / Teleportation Stargate
      // Raised Dias Steps
      add('cylinder', [0, 0.15, 0], [3.2, 0.15, 3.2], pCol, { roughness: 0.5, label: 'Portal Dias Base' });
      add('cylinder', [0, 0.35, 0], [2.6, 0.1, 2.6], pCol, { roughness: 0.45, label: 'Portal Dias Step' });

      // Standing Vertical Arch Ring
      add('torus', [0, 2.4, 0], [1.8, 0.25, 1.8], [0.2, 0.22, 0.25], {
        roughness: 0.2,
        metallic: 0.8,
        label: 'Gateway Metallic Ring',
      });

      // Swirling Event Horizon Core Disk
      add('cylinder', [0, 2.4, 0], [1.5, 0.04, 1.5], eCol, {
        emissive: eCol,
        roughness: 0.05,
        label: 'Event Horizon Energy Vortex',
      });

      // Flanking Focus Pylons
      add('cylinder', [-2.4, 1.6, 0], [0.28, 1.6, 0.28], pCol, { roughness: 0.3, label: 'Pylon Left' });
      add('crystal', [-2.4, 3.4, 0], [0.3, 0.6, 0.3], sCol, { emissive: sCol, label: 'Focus Crystal Left' });

      add('cylinder', [2.4, 1.6, 0], [0.28, 1.6, 0.28], pCol, { roughness: 0.3, label: 'Pylon Right' });
      add('crystal', [2.4, 3.4, 0], [0.3, 0.6, 0.3], sCol, { emissive: sCol, label: 'Focus Crystal Right' });
      break;
    }

    case 'pyramid': {
      // Monumental Golden or Stone Pyramid
      const pyramidSteps = 5;
      let curY = 0.2;
      const baseW = 4.2;

      for (let s = 0; s < pyramidSteps; s++) {
        const stepW = baseW * (1.0 - s * 0.18);
        const stepH = 0.55;
        add('box', [0, curY + stepH * 0.5, 0], [stepW, stepH * 0.5, stepW], pCol, {
          roughness: 0.7,
          label: `Pyramid Step ${s + 1}`,
        });
        curY += stepH;
      }

      // Golden Capstone Beacon (Pyramidion)
      add('cone', [0, curY + 0.6, 0], [0.9, 0.8, 0.9], sCol, {
        metallic: 0.95,
        roughness: 0.1,
        emissive: [sCol[0] * 0.8, sCol[1] * 0.8, sCol[2] * 0.8],
        label: 'Golden Capstone Pyramidion',
      });

      // Front Monumental Portal
      add('box', [0, 0.6, 3.6], [0.6, 0.6, 0.4], [0.15, 0.12, 0.1], { roughness: 0.9, label: 'Pyramid Sanctuary Portal' });
      break;
    }

    case 'tower': {
      // Futuristic / Fantasy Spire Tower
      // Stepped Base
      add('cylinder', [0, 0.3, 0], [2.2, 0.3, 2.2], pCol, { roughness: 0.5, label: 'Tower Base' });
      // Main Shaft
      add('cylinder', [0, 2.8, 0], [1.1, 2.5, 1.1], pCol, { roughness: 0.35, label: 'Tower Shaft' });
      // Observation Cantilever Balcony
      add('cylinder', [0, 5.4, 0], [1.7, 0.25, 1.7], sCol, { roughness: 0.2, metallic: 0.7, label: 'Observation Ring' });
      // Glass Viewing Dome
      add('sphere', [0, 5.8, 0], [1.1, 0.6, 1.1], [0.3, 0.7, 0.9], { roughness: 0.05, label: 'Viewing Dome' });
      // Pinnacle Antenna Spire
      add('cylinder', [0, 7.2, 0], [0.06, 1.2, 0.06], [0.8, 0.8, 0.8], { metallic: 0.9, roughness: 0.1, label: 'Antenna Spire' });
      add('sphere', [0, 8.4, 0], [0.2, 0.2, 0.2], eCol, { emissive: eCol, label: 'Peak Beacon' });
      break;
    }

    case 'modern_villa': {
      // Minimalist Architectural Pavilion
      // Foundation / Patio
      add('box', [0, 0.15, 0], [4.5, 0.15, 3.8], [0.92, 0.92, 0.92], { roughness: 0.25, label: 'Villa Terrazzo Slab' });
      // Reflecting Pool
      add('box', [2.4, 0.18, 1.2], [1.4, 0.05, 1.8], [0.15, 0.45, 0.65], { roughness: 0.05, label: 'Reflecting Water Basin' });
      // Living Glass Pavilion
      add('box', [-1.2, 1.1, 0], [1.8, 0.9, 2.2], [0.8, 0.9, 0.95], { roughness: 0.1, label: 'Glass Pavilion Room' });
      // Cantilevered Roof Slab
      add('box', [-0.8, 2.1, 0.2], [2.8, 0.12, 3.2], [0.18, 0.18, 0.2], { roughness: 0.3, label: 'Cantilever Roof Slab' });
      // Minimalist Steel Support Columns
      add('cylinder', [1.2, 1.05, -1.2], [0.06, 0.95, 0.06], [0.1, 0.1, 0.1], { metallic: 0.9, roughness: 0.2 });
      add('cylinder', [1.2, 1.05, 1.6], [0.06, 0.95, 0.06], [0.1, 0.1, 0.1], { metallic: 0.9, roughness: 0.2 });
      // Warm Interior Glow
      add('sphere', [-1.2, 1.2, 0], [0.35, 0.35, 0.35], eCol, { emissive: eCol, label: 'Interior Architectural Light' });
      break;
    }

    case 'henge': {
      // Mystical Standing Stone Circle
      const hengeRadius = 3.2;
      const stones = 8;
      for (let i = 0; i < stones; i++) {
        const angle = (i * 2 * Math.PI) / stones;
        const hx = Math.cos(angle) * hengeRadius;
        const hz = Math.sin(angle) * hengeRadius;
        add('box', [hx, 1.3, hz], [0.35, 1.3, 0.25], pCol, { roughness: 0.8, label: `Megalith Stone #${i + 1}` });
      }
      // Horizontal Lintels between pairs
      for (let i = 0; i < stones; i += 2) {
        const angle1 = (i * 2 * Math.PI) / stones;
        const angle2 = ((i + 1) * 2 * Math.PI) / stones;
        const midX = (Math.cos(angle1) + Math.cos(angle2)) * 0.5 * hengeRadius;
        const midZ = (Math.sin(angle1) + Math.sin(angle2)) * 0.5 * hengeRadius;
        add('box', [midX, 2.65, midZ], [0.8, 0.18, 0.3], pCol, { roughness: 0.75, label: 'Stone Lintel' });
      }
      // Central Altar Stone
      add('box', [0, 0.45, 0], [1.1, 0.45, 0.7], [0.25, 0.28, 0.32], { roughness: 0.6, label: 'Altar Table' });
      add('crystal', [0, 1.15, 0], [0.25, 0.4, 0.25], eCol, { emissive: eCol, label: 'Altar Relic Crystal' });
      break;
    }

    case 'bridge': {
      // Arched Aqueduct / Viaduct Bridge
      const bridgeLen = 5.4;
      // Main Road Deck
      add('box', [0, 1.8, 0], [1.1, 0.15, bridgeLen], pCol, { roughness: 0.6, label: 'Bridge Deck' });
      // Parapet Railings
      add('box', [-1.15, 2.1, 0], [0.08, 0.25, bridgeLen], pCol, { roughness: 0.5, label: 'Left Railing' });
      add('box', [1.15, 2.1, 0], [0.08, 0.25, bridgeLen], pCol, { roughness: 0.5, label: 'Right Railing' });
      // Arched Support Piers
      const pierZ = [-3.6, -1.2, 1.2, 3.6];
      for (const pz of pierZ) {
        add('box', [0, 0.85, pz], [1.0, 0.85, 0.45], pCol, { roughness: 0.7, label: 'Bridge Pier' });
      }
      // Bridge Lanterns
      add('lantern', [-1.15, 2.5, -2.4], [0.12, 0.18, 0.12], [1.0, 0.8, 0.3], { emissive: eCol });
      add('lantern', [1.15, 2.5, 0], [0.12, 0.18, 0.12], [1.0, 0.8, 0.3], { emissive: eCol });
      add('lantern', [-1.15, 2.5, 2.4], [0.12, 0.18, 0.12], [1.0, 0.8, 0.3], { emissive: eCol });
      break;
    }

    default: {
      // Custom / Artistic Centerpiece
      add('cylinder', [0, 0.2, 0], [2.0, 0.2, 2.0], pCol, { roughness: 0.4, label: 'Sculpture Dias' });
      add('crystal', [0, 1.8, 0], [0.8, 1.5, 0.8], sCol, {
        emissive: [sCol[0] * 1.2, sCol[1] * 1.2, sCol[2] * 1.2],
        roughness: 0.1,
        metallic: 0.4,
        label: 'Central Crystal Artpiece',
      });
      add('torus', [0, 1.8, 0], [1.6, 0.08, 1.6], eCol, { emissive: eCol, label: 'Kinetic Orbit Ring' });
      break;
    }
  }

  return objects;
}
