# Figma Mosaic Plugin

This Figma plugin converts an image into a mosaic using a specified component library of shapes. It allows users to configure various parameters for the mosaic generation, such as tile size and matching resolution. It's based on [Codebox's Mosaic.py](https://github.com/codebox/mosaic).

## Features

- Convert images into mosaics using shapes from a component library.

## Installation

1. Open Figma and go to the Plugins menu.
2. Select "Development" and then "Import Plugin from Manifest..."
3. Choose the `manifest.json` file from the project directory.
4. Run the plugin from the Plugins menu.

## Usage

1. Create components in your Figma file that are exactly 50x50 pixels
2. Select the image you want to convert to a mosaic
3. Run the plugin and click "Create Mosaic"
4. Configure the following options:
   - **Tile Size (px)**: Size of each tile in pixels.
   - **Scale**: Enlargement factor for the mosaic.
   - **Detail (1-10)**: Matching resolution for tiles.
   - **Variations (slower)**: Number of variations to generate.
   - **Variance Threshold**: Threshold for variance in quadtree subdivision.
   - **Max Quadtree Levels**: Maximum levels for quadtree subdivision.
   - **Use all variants (recommended)**: Whether to use all variants of the selected component.
   - **Image transparency is white**: Treat transparent pixels in the image as white.
   - **Component transparency is white**: Treat transparent pixels in the components as white.

## License

This project is licensed under the MIT License. See the LICENSE file for details.