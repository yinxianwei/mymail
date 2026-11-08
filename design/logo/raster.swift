import Cocoa

// Rasterises an SVG into a square PNG with alpha.
let args = CommandLine.arguments
guard args.count >= 4, let size = Int(args[3]) else {
  print("usage: raster <svg> <out.png> <size>")
  exit(2)
}
let svgURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
guard let image = NSImage(contentsOf: svgURL) else { print("cannot read svg"); exit(1) }
guard let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
) else { print("no rep"); exit(1) }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current?.imageInterpolation = .high
image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
NSGraphicsContext.restoreGraphicsState()
guard let png = rep.representation(using: .png, properties: [:]) else { print("no png"); exit(1) }
try png.write(to: outURL)
print("wrote \(outURL.lastPathComponent) \(size)x\(size)")
