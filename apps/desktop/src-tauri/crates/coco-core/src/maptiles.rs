//! swisstopo WMTS tile URLs for the GPX viewer. The URL is built only from the fixed host and the
//! `MapLayer` enum plus validated numeric coordinates, never from input strings.

use url::Url;

use crate::error::CoreError;

/// The only host tiles are fetched from.
pub const TILE_HOST: &str = "wmts.geo.admin.ch";
/// Highest zoom level we serve.
pub const MAX_ZOOM: u32 = 18;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MapLayer {
    Base,
    Hiking,
    Slope,
}

impl MapLayer {
    pub fn parse(s: &str) -> Result<Self, CoreError> {
        match s {
            "base" => Ok(Self::Base),
            "hiking" => Ok(Self::Hiking),
            "slope" => Ok(Self::Slope),
            other => Err(CoreError::Invalid(format!("unbekannte Kartenebene: {other}"))),
        }
    }

    fn layer_id(self) -> &'static str {
        match self {
            Self::Base => "ch.swisstopo.pixelkarte-farbe",
            Self::Hiking => "ch.swisstopo.swisstlm3d-wanderwege",
            Self::Slope => "ch.swisstopo.hangneigung-ueber_30",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Base => "jpeg",
            Self::Hiking | Self::Slope => "png",
        }
    }

    /// Content type the layer is expected to return.
    pub fn content_type(self) -> &'static str {
        match self {
            Self::Base => "image/jpeg",
            Self::Hiking | Self::Slope => "image/png",
        }
    }
}

/// Validates the tile coordinates: `z <= 18`, `x` and `y` below `2^z`.
pub fn validate_tile(z: u32, x: u32, y: u32) -> Result<(), CoreError> {
    if z > MAX_ZOOM {
        return Err(CoreError::Invalid(format!("Zoomstufe {z} ausserhalb 0..={MAX_ZOOM}")));
    }
    let n = 1u32 << z;
    if x >= n || y >= n {
        return Err(CoreError::Invalid(format!("Kachel {x}/{y} ausserhalb des Bereichs für Zoom {z}")));
    }
    Ok(())
}

/// Builds the tile URL for a layer and validated coordinates.
pub fn tile_url(layer: MapLayer, z: u32, x: u32, y: u32) -> Result<Url, CoreError> {
    validate_tile(z, x, y)?;
    let s = format!(
        "https://{TILE_HOST}/1.0.0/{}/default/current/3857/{z}/{x}/{y}.{}",
        layer.layer_id(),
        layer.extension()
    );
    Url::parse(&s).map_err(|e| CoreError::InvalidUrl(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_layers() {
        assert_eq!(MapLayer::parse("base").unwrap(), MapLayer::Base);
        assert_eq!(MapLayer::parse("hiking").unwrap(), MapLayer::Hiking);
        assert_eq!(MapLayer::parse("slope").unwrap(), MapLayer::Slope);
    }

    #[test]
    fn rejects_unknown_layer() {
        assert!(MapLayer::parse("satellite").is_err());
        assert!(MapLayer::parse("").is_err());
        assert!(MapLayer::parse("Base").is_err());
        assert!(MapLayer::parse("../base").is_err());
    }

    #[test]
    fn urls_are_exact() {
        assert_eq!(
            tile_url(MapLayer::Base, 12, 2144, 1435).unwrap().as_str(),
            "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/12/2144/1435.jpeg"
        );
        assert_eq!(
            tile_url(MapLayer::Hiking, 14, 8500, 5700).unwrap().as_str(),
            "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swisstlm3d-wanderwege/default/current/3857/14/8500/5700.png"
        );
        assert_eq!(
            tile_url(MapLayer::Slope, 0, 0, 0).unwrap().as_str(),
            "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hangneigung-ueber_30/default/current/3857/0/0/0.png"
        );
    }

    #[test]
    fn rejects_zoom_above_18() {
        assert!(tile_url(MapLayer::Base, 18, 0, 0).is_ok());
        assert!(tile_url(MapLayer::Base, 19, 0, 0).is_err());
        assert!(tile_url(MapLayer::Base, 40, 0, 0).is_err());
    }

    #[test]
    fn rejects_out_of_range_coordinates() {
        assert!(tile_url(MapLayer::Base, 3, 7, 7).is_ok());
        assert!(tile_url(MapLayer::Base, 3, 8, 0).is_err());
        assert!(tile_url(MapLayer::Base, 3, 0, 8).is_err());
        assert!(tile_url(MapLayer::Base, 0, 1, 0).is_err());
    }

    #[test]
    fn content_types() {
        assert_eq!(MapLayer::Base.content_type(), "image/jpeg");
        assert_eq!(MapLayer::Slope.content_type(), "image/png");
    }

    #[test]
    fn host_is_fixed() {
        let u = tile_url(MapLayer::Hiking, 10, 1, 2).unwrap();
        assert_eq!(u.host_str(), Some(TILE_HOST));
        assert_eq!(u.scheme(), "https");
    }
}
