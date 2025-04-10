// Mosaic Plugin for Figma - Improved implementation with Canvas API brightness calculation

// Updated interface to include transparency options and color matching
interface MosaicConfig {
  tileSize: number;
  componentId?: string;
  enlargement: number;
  matchResolution: number;
  useComponentVariants: boolean;
  imageTransparencyIsWhite: boolean;
  componentTransparencyIsWhite: boolean;
  variationCount: number;
  varianceThreshold: number;
  maxQuadtreeLevels: number;
}

// Updated data structures for cell and component data
interface CellData {
  brightness: number;
  color: { r: number, g: number, b: number };
  transparencyRatio: number;
}

interface ComponentData {
  component: ComponentNode;
  brightness: number;
  color: { r: number, g: number, b: number };
  transparencyRatio: number;
}

// Main plugin code
figma.showUI(__html__, { width: 240, height: 350 });

// Type guard to check if node has fills
function hasFills(node: SceneNode): node is SceneNode & { fills: ReadonlyArray<Paint> } {
  return 'fills' in node && Array.isArray(node.fills);
}

// Function to get image data
async function getImageData(
  node: SceneNode,
  gridSize: { width: number, height: number },
  config: MosaicConfig
): Promise<CellData[][]> {
  // Export the image as PNG
  let bytes: Uint8Array;
  try {
    bytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 }
    });
  } catch (error) {
    console.error('Failed to export image:', error);
    // Create a fallback data map with default values
    const result: CellData[][] = [];
    for (let y = 0; y < gridSize.height; y++) {
      result[y] = [];
      for (let x = 0; x < gridSize.width; x++) {
        const relativeX = x / gridSize.width;
        const relativeY = y / gridSize.height;
        // Create a simple gradient fallback
        result[y][x] = {
          brightness: 0.3 + relativeX * 0.4 + relativeY * 0.3,
          color: { 
            r: 0.3 + relativeX * 0.7, 
            g: 0.3 + relativeY * 0.7, 
            b: 0.5 
          },
          transparencyRatio: 0
        };
      }
    }
    return result;
  }
  
  // Process the image data in UI context
  figma.ui.postMessage({
    type: 'process-image',
    bytes,
    gridSize,
    imageTransparencyIsWhite: config.imageTransparencyIsWhite
  });
  
  console.log("Sent image to UI for processing");
  
  // Return a Promise that will resolve when UI sends back the result
  return new Promise((resolve) => {
    const handler = (msg: any) => {
      if (msg.type === 'image-data-result' && msg.dataMap) {
        console.log("Received image data from UI");
        figma.ui.off('message', handler);
        resolve(msg.dataMap);
      }
    };
    
    figma.ui.on('message', handler);
    
    // Add timeout for fallback
    setTimeout(() => {
      console.log("Timeout waiting for image data");
      figma.ui.off('message', handler);
      
      // Create a fallback data map
      const result: CellData[][] = [];
      for (let y = 0; y < gridSize.height; y++) {
        result[y] = [];
        for (let x = 0; x < gridSize.width; x++) {
          const relativeX = x / gridSize.width;
          const relativeY = y / gridSize.height;
          result[y][x] = {
            brightness: 0.3 + relativeX * 0.4 + relativeY * 0.3,
            color: { 
              r: 0.3 + relativeX * 0.7, 
              g: 0.3 + relativeY * 0.7, 
              b: 0.5 
            },
            transparencyRatio: 0
          };
        }
      }
      resolve(result);
    }, 10000);
  });
}

// Function to get component data
async function getComponentData(
  components: ComponentNode[], 
  config: MosaicConfig
): Promise<ComponentData[]> {
  figma.notify(`Analyzing ${components.length} components...`, { timeout: 1000 });
  
  // Create array to hold component data
  const componentData: ComponentData[] = [];
  const pendingResults = new Map<string, {
    component: ComponentNode,
    resolve: (data: any) => void
  }>();
  
  // Set up message handler
  const messageHandler = (msg: any) => {
    if (msg.type === 'component-data-result' && msg.componentId) {
      const pending = pendingResults.get(msg.componentId);
      if (pending) {
        console.log(`Received data for ${msg.componentId}`);
        pending.resolve(msg.componentData);
        pendingResults.delete(msg.componentId);
      }
    }
  };
  
  figma.ui.on('message', messageHandler);
  
  // Process components in parallel
  const promises = components.map(async (component) => {
    try {
      // Export component as PNG
      const bytes = await component.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 1 }
      });
      
      // Calculate component data using UI
      const data = await new Promise<any>((resolve) => {
        pendingResults.set(component.id, { component, resolve });
        
        figma.ui.postMessage({
          type: 'process-component',
          componentId: component.id,
          bytes,
          componentTransparencyIsWhite: config.componentTransparencyIsWhite
        });
        
        // Add timeout for this component
        setTimeout(() => {
          if (pendingResults.has(component.id)) {
            console.log(`Timeout for component ${component.id}`);
            pendingResults.delete(component.id);
            resolve({
              brightness: 0.5,
              color: { r: 0.5, g: 0.5, b: 0.5 },
              transparencyRatio: 0
            });
          }
        }, 5000);
      });
      
      return { component, ...data };
    } catch (error) {
      console.error(`Error processing component ${component.name}:`, error);
      return { 
        component, 
        brightness: 0.5,
        color: { r: 0.5, g: 0.5, b: 0.5 },
        transparencyRatio: 0
      };
    }
  });
  
  // Wait for all promises to resolve
  const results = await Promise.all(promises);
  
  // Clean up
  figma.ui.off('message', messageHandler);
  
  return results;
}

// Helper function to create variations of the mosaic
async function createMosaicVariations(
  baseFrame: FrameNode, 
  imageData: CellData[][], 
  componentLibrary: ComponentData[],
  config: MosaicConfig,
  xTileCount: number,
  yTileCount: number,
  variationCount: number
) {
  // Skip if only one variation requested (original already created)
  if (variationCount <= 1) return;
  
  figma.notify(`Creating ${variationCount - 1} variations...`, {timeout: 2000});
  
  // Create a parent frame to hold all mosaics
  const parentFrame = figma.createFrame();
  parentFrame.name = 'Mosaic Variations';
  
  // Calculate size based on original mosaic
  const mosaicWidth = baseFrame.width;
  const mosaicHeight = baseFrame.height;
  const parentWidth = mosaicWidth;
  const parentHeight = mosaicHeight * variationCount + (20 * (variationCount - 1)); // Add spacing between variations
  
  parentFrame.resize(parentWidth, parentHeight);
  parentFrame.x = baseFrame.x;
  parentFrame.y = baseFrame.y;
  
  // Add original mosaic to the parent frame
  figma.currentPage.appendChild(parentFrame);
  
  const originalMosaic = baseFrame.clone();
  originalMosaic.x = 0;
  originalMosaic.y = 0;
  parentFrame.appendChild(originalMosaic);
  baseFrame.remove(); // Remove the original standalone mosaic
  
  // Keep track of existing instance placements
  const instanceMap = new Map<string, ComponentNode>();
  
  // Build a map of the original mosaic components
  originalMosaic.children.forEach((child, index) => {
    if (child.type === 'INSTANCE') {
      const x = Math.floor(child.x / config.tileSize);
      const y = Math.floor(child.y / config.tileSize);
      instanceMap.set(`${x},${y}`, child.mainComponent);
    }
  });
  
  // Create each variation
  for (let i = 1; i < variationCount; i++) {
    try {
      // Create new mosaic (clone the original)
      const newMosaic = originalMosaic.clone();
      newMosaic.name = `Mosaic Variation ${i + 1}`;
      newMosaic.y = i * (mosaicHeight + 20); // Position below previous, with spacing
      parentFrame.appendChild(newMosaic);
      
      // Replace 5-10% of instances randomly
      const replacementPercentage = 5 + Math.floor(Math.random() * 6); // 5-10%
      const totalInstances = xTileCount * yTileCount;
      const numToReplace = Math.floor((replacementPercentage / 100) * totalInstances);
      
      // Choose random positions to replace
      const positionsToReplace = new Set<string>();
      while (positionsToReplace.size < numToReplace) {
        const x = Math.floor(Math.random() * xTileCount);
        const y = Math.floor(Math.random() * yTileCount);
        positionsToReplace.add(`${x},${y}`);
      }
      
      // Replace selected components with better alternatives
      positionsToReplace.forEach(posKey => {
        const [xStr, yStr] = posKey.split(',');
        const x = parseInt(xStr);
        const y = parseInt(yStr);
        
        // Find the instance at this position
        const instance = newMosaic.children.find(child => {
          return child.type === 'INSTANCE' && 
                 Math.floor(child.x / config.tileSize) === x && 
                 Math.floor(child.y / config.tileSize) === y;
        }) as InstanceNode;
        
        if (!instance) return; // Skip if not found
        
        // Get image data for this position
        const mapX = Math.min(imageData[0].length - 1, Math.floor(x * imageData[0].length / xTileCount));
        const mapY = Math.min(imageData.length - 1, Math.floor(y * imageData.length / yTileCount));
        const cellData = imageData[mapY][mapX];
        
        // Find a different component with a good match but not the exact same component
        const currentComponent = instance.mainComponent;
        const alternativeComponents = componentLibrary
          .filter(comp => comp.component.id !== currentComponent.id)
          .map(comp => {
            // Calculate brightness and color differences
            const brightnessDiff = Math.abs(cellData.brightness - comp.brightness);
            const colorDiff = Math.sqrt(
              Math.pow(cellData.color.r - comp.color.r, 2) +
              Math.pow(cellData.color.g - comp.color.g, 2) +
              Math.pow(cellData.color.b - comp.color.b, 2)
            ) / Math.sqrt(3);
            
            // Combined score (lower is better)
            const score = brightnessDiff * 0.6 + colorDiff * 0.4;
            
            return {
              component: comp.component,
              score
            };
          });
        
        // Sort by score (best matches first)
        alternativeComponents.sort((a, b) => a.score - b.score);
        
        // Pick one of the top 3 alternatives to introduce more randomness
        const randomIndex = Math.floor(Math.random() * Math.min(3, alternativeComponents.length));
        const selectedComponent = alternativeComponents[randomIndex]?.component;
        
        if (selectedComponent) {
          // Replace the instance
          const newInstance = selectedComponent.createInstance();
          newInstance.x = instance.x;
          newInstance.y = instance.y;
          newInstance.resize(config.tileSize, config.tileSize);
          
          // Add new instance and remove old one
          newMosaic.appendChild(newInstance);
          instance.remove();
        }
      });
      
      // Let the UI update between variations
      await new Promise(resolve => setTimeout(resolve, 0));
      
      figma.notify(`Created variation ${i + 1} of ${variationCount}`, {timeout: 500});
    } catch (error) {
      console.error(`Error creating variation ${i + 1}:`, error);
    }
  }
  
  figma.notify(`Created ${variationCount} mosaic variations`, {timeout: 2000});
}

// Function to calculate variance of a region
function calculateVariance(imageData: CellData[][], x: number, y: number, width: number, height: number): number {
  let totalBrightness = 0;
  let totalPixels = 0;
  for (let i = y; i < y + height; i++) {
    for (let j = x; j < x + width; j++) {
      const pixel = imageData[i][j];
      totalBrightness += pixel.brightness;
      totalPixels++;
    }
  }
  const meanBrightness = totalBrightness / totalPixels;
  let variance = 0;
  for (let i = y; i < y + height; i++) {
    for (let j = x; j < x + width; j++) {
      const pixel = imageData[i][j];
      variance += Math.pow(pixel.brightness - meanBrightness, 2);
    }
  }
  return variance / totalPixels;
}

// Quadtree node class
class QuadtreeNode {
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  children: QuadtreeNode[];

  constructor(x: number, y: number, width: number, height: number, level: number) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.level = level;
    this.children = [];
  }

  subdivide(imageData: CellData[][], varianceThreshold: number, maxLevels: number) {
    if (this.level >= maxLevels) return;

    const variance = calculateVariance(imageData, this.x, this.y, this.width, this.height);
    console.log(`Variance at level ${this.level} for region (${this.x}, ${this.y}, ${this.width}, ${this.height}): ${variance}`);
    if (variance < varianceThreshold) return;

    const halfWidth = Math.floor(this.width / 2);
    const halfHeight = Math.floor(this.height / 2);

    this.children.push(new QuadtreeNode(this.x, this.y, halfWidth, halfHeight, this.level + 1));
    this.children.push(new QuadtreeNode(this.x + halfWidth, this.y, halfWidth, halfHeight, this.level + 1));
    this.children.push(new QuadtreeNode(this.x, this.y + halfHeight, halfWidth, halfHeight, this.level + 1));
    this.children.push(new QuadtreeNode(this.x + halfWidth, this.y + halfHeight, halfWidth, halfHeight, this.level + 1));

    this.children.forEach(child => child.subdivide(imageData, varianceThreshold, maxLevels));
  }
}

// Function to create quadtree from image data
function createQuadtree(imageData: CellData[][], varianceThreshold: number, maxLevels: number): QuadtreeNode {
  const root = new QuadtreeNode(0, 0, imageData[0].length, imageData.length, 0);
  root.subdivide(imageData, varianceThreshold, maxLevels);
  return root;
}

// Create the mosaic using brightness and color data
async function createMosaic(
  selectedImage: SceneNode, 
  componentLibrary: ComponentData[], 
  config: MosaicConfig, 
  imageData: CellData[][]
) {
  try {
    console.log(`Creating mosaic with ${componentLibrary.length} components`);
    
    // Create a frame to hold the mosaic
    const mosaicGroup = figma.createFrame();
    mosaicGroup.name = 'Mosaic';
    
    // Calculate dimensions
    const width = selectedImage.width * config.enlargement;
    const height = selectedImage.height * config.enlargement;
    mosaicGroup.resize(width, height);
    
    // Position the frame
    mosaicGroup.x = selectedImage.x;
    mosaicGroup.y = selectedImage.y + selectedImage.height + 20;
    
    // Add to current page first so any errors are visible
    figma.currentPage.appendChild(mosaicGroup);
    console.log("Created mosaic frame");
    
    // Calculate tile count
    const xTileCount = Math.floor(width / config.tileSize);
    const yTileCount = Math.floor(height / config.tileSize);
    
    if (xTileCount <= 0 || yTileCount <= 0) {
      figma.notify(`Unable to create mosaic: tile count would be ${xTileCount}x${yTileCount}`);
      mosaicGroup.remove();
      return;
    }
    
    console.log(`Creating ${xTileCount}x${yTileCount} mosaic grid`);
    
    // Count tiles for progress
    let completedTiles = 0;
    const totalTiles = xTileCount * yTileCount;
    
    // Process in batches to prevent UI freezing
    const BATCH_SIZE = 20;
    
    // Map of how many times each component has been used
    const componentUsage = new Map<string, number>();
    
    // Verify data dimensions
    if (imageData.length === 0 || imageData[0].length === 0) {
      console.error("Image data is empty!");
      figma.notify("Error: Image data is invalid");
      mosaicGroup.remove();
      return;
    }
    
    const quadtree = createQuadtree(imageData, config.varianceThreshold, config.maxQuadtreeLevels);
    const nodesToProcess = [quadtree];

    while (nodesToProcess.length > 0) {
      const node = nodesToProcess.pop();
      if (!node) continue; // Ensure node is valid

      if (node.children.length === 0) {
        const mapX = Math.min(imageData[0].length - 1, Math.floor(node.x * imageData[0].length / width));
        const mapY = Math.min(imageData.length - 1, Math.floor(node.y * imageData.length / height));
        const cellData = imageData[mapY][mapX];

        let bestMatch = componentLibrary[0].component;
        let bestScore = Number.MAX_VALUE;

        for (const compData of componentLibrary) {
          const brightnessDiff = Math.abs(cellData.brightness - compData.brightness);
          const colorDiff = Math.sqrt(
            Math.pow(cellData.color.r - compData.color.r, 2) +
            Math.pow(cellData.color.g - compData.color.g, 2) +
            Math.pow(cellData.color.b - compData.color.b, 2)
          ) / Math.sqrt(3);
          const score = brightnessDiff * 0.6 + colorDiff * 0.4;

          if (score < bestScore) {
            bestScore = score;
            bestMatch = compData.component;
          }
        }

        const instance = bestMatch.createInstance();
        instance.x = node.x * config.tileSize;
        instance.y = node.y * config.tileSize;
        instance.resize(node.width * config.tileSize, node.height * config.tileSize);
        mosaicGroup.appendChild(instance);

        completedTiles++;
        const currentUsage = componentUsage.get(bestMatch.id) || 0;
        componentUsage.set(bestMatch.id, currentUsage + 1);
      } else {
        nodesToProcess.push(...node.children);
      }
    }
    
    // Calculate statistics about component usage
    const uniqueComponentsUsed = componentUsage.size;
    let mostUsedComponent = '';
    let maxUseCount = 0;
    
    componentUsage.forEach((count, id) => {
      if (count > maxUseCount) {
        maxUseCount = count;
        mostUsedComponent = id;
      }
    });
    
    const mostUsedName = componentLibrary.find(c => c.component.id === mostUsedComponent)?.component.name || 'Unknown';
    
    // Final notification
    figma.notify(`Mosaic created with ${completedTiles} tiles using ${uniqueComponentsUsed} different components.`);
    
    // Create variations if requested
    if (config.variationCount > 1) {
      await createMosaicVariations(
        mosaicGroup, 
        imageData, 
        componentLibrary, 
        config,
        xTileCount,
        yTileCount,
        config.variationCount
      );
    }
    
  } catch (error) {
    console.error("Error creating mosaic:", error);
    figma.notify("Error creating mosaic. See console for details.");
  }
}

// Function to collect component variants
function getComponentVariants(component: ComponentNode | ComponentSetNode, useVariants: boolean): ComponentNode[] {
  const components: ComponentNode[] = [];
  
  if (component.type === 'COMPONENT') {
    // Single component with no variants
    components.push(component);
  } else if (component.type === 'COMPONENT_SET' && useVariants) {
    // Component set with variants - add all variants if requested
    component.children.forEach(child => {
      if (child.type === 'COMPONENT') {
        components.push(child);
      }
    });
  } else if (component.type === 'COMPONENT_SET' && !useVariants) {
    // Just use the default variant if not using all variants
    const defaultVariant = component.defaultVariant;
    if (defaultVariant) {
      components.push(defaultVariant);
    } else if (component.children.length > 0) {
      // Fall back to first variant if no default
      const firstChild = component.children[0];
      if (firstChild.type === 'COMPONENT') {
        components.push(firstChild);
      }
    }
  }
  
  return components;
}

// Function to get component sets from current page only
function getCurrentPageComponents() {
  const componentsList: Array<{id: string, name: string}> = [];
  
  try {
    // Find component sets in the current page
    const componentSets = figma.currentPage.findAll(node => node.type === 'COMPONENT_SET') as ComponentSetNode[];
    componentSets.forEach(set => {
      componentsList.push({
        id: set.id,
        name: set.name + ' (Component Set)'
      });
    });
    
    // Also find standalone components (those without variants)
    const standaloneComponents = figma.currentPage.findAll(
      node => node.type === 'COMPONENT' && node.parent?.type !== 'COMPONENT_SET'
    ) as ComponentNode[];
    
    standaloneComponents.forEach(component => {
      componentsList.push({
        id: component.id,
        name: component.name
      });
    });
  } catch (error) {
    console.error('Error getting components from current page:', error);
  }
  
  return componentsList;
}

// Plugin UI message handler
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'get-current-page-components') {
    // Send list of components from current page to UI
    figma.ui.postMessage({
      type: 'current-page-components',
      components: getCurrentPageComponents()
    });
  } 
  else if (msg.type === 'create-mosaic') {
    const config: MosaicConfig = msg.config;
    console.log('Received config:', config);

    // Get selected nodes
    const selection = figma.currentPage.selection;
    
    if (selection.length === 0) {
      figma.notify('Please select an image');
      return;
    }
    
    if (!config.componentId) {
      figma.notify('Please select a component');
      return;
    }

    // Find the selected component
    const component = figma.getNodeById(config.componentId);
    if (!component || (component.type !== 'COMPONENT' && component.type !== 'COMPONENT_SET')) {
      figma.notify('Invalid component selected');
      return;
    }
    
    // Get component variants based on configuration
    const rawComponentLibrary = getComponentVariants(
      component as ComponentNode | ComponentSetNode, 
      config.useComponentVariants
    );
    
    if (rawComponentLibrary.length === 0) {
      figma.notify('No valid components found');
      return;
    }
    
    // Limit variation count based on number of components
    const effectiveVariationCount = Math.min(config.variationCount, 10);
    if (effectiveVariationCount !== config.variationCount) {
      console.log(`Limiting to ${effectiveVariationCount} variations for performance`);
    }
    
    console.log(`Using ${rawComponentLibrary.length} component variants`);
    figma.notify(`Creating mosaic using ${rawComponentLibrary.length} component variants...`);
    
    // Calculate grid size based on tile size and enlargement
    const selectedImage = selection[0];
    const gridWidth = Math.floor((selectedImage.width * config.enlargement) / config.tileSize);
    const gridHeight = Math.floor((selectedImage.height * config.enlargement) / config.tileSize);
    
    try {
      // Show processing message
      figma.notify("Analyzing image...");
      
      // Get image data using UI context processing
      console.log("Getting image data...");
      const imageData = await getImageData(
        selectedImage,
        { width: gridWidth, height: gridHeight },
        config
      );
      
      // Process components to get brightness and color values
      console.log("Getting component data...");
      const componentLibrary = await getComponentData(rawComponentLibrary, config);
      
      // Create the mosaic with the processed data
      console.log("Creating mosaic...");
      await createMosaic(
        selectedImage, 
        componentLibrary, 
        {...config, variationCount: effectiveVariationCount}, 
        imageData
      );
      
    } catch (error) {
      console.error('Error creating mosaic:', error);
      figma.notify('Error creating mosaic. See console for details.');
    }
  }
  
  // These handlers are not needed since we're using promises with closures
  else if (msg.type === 'image-data-result') {
    console.log('Received image data from UI (main handler)');
    // This will be handled by the Promise in getImageData
  }
  
  else if (msg.type === 'component-data-result') {
    console.log(`Received data for component ${msg.componentId} (main handler)`);
    // This will be handled by the Promise in getComponentData
  }
};