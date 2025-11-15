from smplat_api.schemas.product import ProductOptionMetadata


def test_product_option_metadata_blueprint_fields_roundtrip() -> None:
    payload = {
        "marketingTagline": "100 followers in a week",
        "fulfillmentSla": "48h turnaround",
        "heroImageUrl": "https://cdn.example.com/hero.png",
        "calculator": {
            "expression": "amount / days",
            "sampleAmount": 200,
            "sampleDays": 10,
        },
    }

    metadata = ProductOptionMetadata.model_validate(payload)

    assert metadata.marketing_tagline == "100 followers in a week"
    assert metadata.fulfillment_sla == "48h turnaround"
    assert metadata.hero_image_url == "https://cdn.example.com/hero.png"
    assert metadata.calculator is not None
    assert metadata.calculator.expression == "amount / days"
    assert metadata.calculator.sample_amount == 200
    assert metadata.calculator.sample_days == 10

    dumped = metadata.model_dump(by_alias=True, exclude_none=True)
    assert dumped["marketingTagline"] == payload["marketingTagline"]
    assert dumped["calculator"]["sampleAmount"] == 200
