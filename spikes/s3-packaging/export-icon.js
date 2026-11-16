// osascript -l JavaScript export-icon.js <path/to/App.app> <out.png> [size]
// Writes the icon Finder/Dock would show (NSWorkspace.iconForFile) as PNG.
ObjC.import("AppKit");

function run(argv) {
  const [appPath, outPath, sizeArg] = argv;
  const size = Number(sizeArg || 256);
  const image = $.NSWorkspace.sharedWorkspace.iconForFile(appPath);
  const rep =
    $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null,
      size,
      size,
      8,
      4,
      true,
      false,
      $.NSCalibratedRGBColorSpace,
      0,
      0,
    );
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext(
    $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep),
  );
  image.drawInRectFromRectOperationFraction(
    $.NSMakeRect(0, 0, size, size),
    $.NSZeroRect,
    $.NSCompositingOperationCopy,
    1,
  );
  $.NSGraphicsContext.restoreGraphicsState;
  const png = rep.representationUsingTypeProperties(
    $.NSBitmapImageFileTypePNG,
    $(),
  );
  png.writeToFileAtomically(outPath, true);
  return `wrote ${outPath} (${size}x${size}) from ${appPath}`;
}
