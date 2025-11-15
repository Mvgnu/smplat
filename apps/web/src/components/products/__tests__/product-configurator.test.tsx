import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ProductConfigurator, type ConfiguratorOptionGroup, type SubscriptionPlan, type ConfiguratorCustomField } from '../product-configurator';

const mockOptionGroups: ConfiguratorOptionGroup[] = [
  {
    id: 'targeting',
    name: 'Targeting Options',
    type: 'multiple',
    options: [
      { id: 'geo', label: 'Geographic Targeting', priceDelta: 200 },
      { id: 'interest', label: 'Interest Targeting', priceDelta: 150 },
      { id: 'lookalike', label: 'Lookalike Audiences', priceDelta: 300 }
    ]
  },
  {
    id: 'format',
    name: 'Ad Format',
    type: 'single',
    required: true,
    options: [
      { id: 'story', label: 'Story Ads', priceDelta: 0, recommended: true },
      { id: 'feed', label: 'Feed Ads', priceDelta: 100 },
      { id: 'reel', label: 'Reel Ads', priceDelta: 200 }
    ]
  }
];

const mockAddOns = [
  {
    id: 'analytics',
    label: 'Advanced Analytics',
    priceDelta: 50,
    metadata: { pricing: { mode: 'flat', amount: 50 } },
    metadataJson: { pricing: { mode: 'flat', amount: 50 } },
    pricing: { mode: 'flat', amount: 50 },
    computedDelta: 50
  },
  {
    id: 'reporting',
    label: 'Custom Reports',
    priceDelta: 75,
    metadata: { pricing: { mode: 'percentage', amount: 0.1 } },
    metadataJson: { pricing: { mode: 'percentage', amount: 0.1 } },
    pricing: { mode: 'percentage', amount: 0.1, percentageMultiplier: 0.1 },
    computedDelta: 75,
    percentageMultiplier: 0.1
  }
] as const;

describe('ProductConfigurator', () => {
  const defaultProps = {
    basePrice: 1000,
    currency: 'EUR',
    optionGroups: mockOptionGroups,
    addOns: mockAddOns.map((addOn) => ({ ...addOn })),
    onChange: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render configurator with base price', () => {
    render(<ProductConfigurator {...defaultProps} />);

    expect(screen.getByText('Configure your campaign')).toBeInTheDocument();
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,000');
  });

  it('should calculate price with selected options', () => {
    render(<ProductConfigurator {...defaultProps} />);

    // Select geographic targeting (+200)
    fireEvent.click(screen.getByText('Geographic Targeting'));

    // Select feed ads (+100)
    fireEvent.click(screen.getByText('Feed Ads'));

    // Check updated price: 1000 (base) + 200 (geo) + 100 (feed) = 1300
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,300');
  });

  it('should handle single selection option groups', () => {
    render(<ProductConfigurator {...defaultProps} />);

    // Initially should have recommended option selected (Story Ads - 0)
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,000');

    // Click feed ads (should replace story ads)
    fireEvent.click(screen.getByText('Feed Ads'));

    // Price should update: 1000 (base) + 100 (feed) = 1100
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,100');
  });

  it('should handle multiple selection option groups', () => {
    render(<ProductConfigurator {...defaultProps} />);

    // Select multiple targeting options
    fireEvent.click(screen.getByText('Geographic Targeting'));
    fireEvent.click(screen.getByText('Interest Targeting'));

    // Price should be: 1000 (base) + 200 (geo) + 150 (interest) = 1350
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,350');
  });

  it('should handle add-ons selection', () => {
    render(<ProductConfigurator {...defaultProps} />);

    // Select analytics add-on (+50)
    fireEvent.click(screen.getByText('Advanced Analytics'));

    // Price should be: 1000 (base) + 50 (analytics) = 1050
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,050');
  });

  it('should call onChange callback with correct data', () => {
    const onChange = jest.fn();
    render(<ProductConfigurator {...defaultProps} onChange={onChange} />);

    // Select an option
    fireEvent.click(screen.getByText('Geographic Targeting'));

    // Should call onChange with correct structure
    expect(onChange).toHaveBeenCalledWith({
      total: 1200, // 1000 base + 200 geo
      selectedOptions: {
        targeting: ['geo'],
        format: ['story'] // recommended option
      },
      addOns: [],
      subscriptionPlanId: undefined,
      customFieldValues: {},
      presetId: null
    });
  });

  it('should handle required option groups', () => {
    render(<ProductConfigurator {...defaultProps} />);

    // Ad Format group should show as required
    expect(screen.getByText('Required')).toBeInTheDocument();

    // Should have default selection for required single-select group
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,000'); // Story ads selected by default
  });

  it('should handle subscription plans', () => {
    const subscriptionPlans: SubscriptionPlan[] = [
      { id: 'monthly', label: 'Monthly', billingCycle: 'monthly', priceMultiplier: 1, default: true },
      { id: 'quarterly', label: 'Quarterly', billingCycle: 'quarterly', priceMultiplier: 3 }
    ];

    render(<ProductConfigurator {...defaultProps} subscriptionPlans={subscriptionPlans} />);

    // Should show billing cadence section
    expect(screen.getByText('Billing cadence')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();

    // Select quarterly plan
    fireEvent.click(screen.getByText('Quarterly'));

    // Price should be multiplied: 1000 * 3 = 3000
    expect(screen.getByTestId('total-price')).toHaveTextContent('€3,000');
  });

  it('should handle custom fields', () => {
    const customFields: ConfiguratorCustomField[] = [
      { id: 'username', label: 'Instagram Username', type: 'text', required: true, placeholder: '@username' },
      { id: 'budget', label: 'Monthly Budget', type: 'number', helpText: 'Enter monthly budget' }
    ];

    render(<ProductConfigurator {...defaultProps} customFields={customFields} />);

    // Should show custom fields section
    expect(screen.getByText('Campaign inputs')).toBeInTheDocument();
    expect(screen.getByText('Instagram Username')).toBeInTheDocument();
    expect(screen.getByText('Monthly Budget')).toBeInTheDocument();

    // Fill in fields by selecting inputs by type
    const textInputs = screen.getAllByRole('textbox');
    const numberInputs = screen.getAllByRole('spinbutton');

    fireEvent.change(textInputs[0], { target: { value: 'testuser' } });
    fireEvent.change(numberInputs[0], { target: { value: '5000' } });

    // Should call onChange with field values
    expect(defaultProps.onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        customFieldValues: {
          username: 'testuser',
          budget: '5000'
        }
      })
    );
  });

  it('applies configuration presets when requested', () => {
    const configurationPresets = [
      {
        id: 'preset-hero',
        label: 'Hero bundle',
        selection: {
          optionSelections: {
            format: ['feed']
          },
          addOnIds: ['analytics'],
          subscriptionPlanId: undefined,
          customFieldValues: {}
        }
      }
    ];

    const onChange = jest.fn();
    render(<ProductConfigurator {...defaultProps} configurationPresets={configurationPresets} onChange={onChange} />);

    const applyButton = screen.getByTestId('apply-preset-preset-hero');
    fireEvent.click(applyButton);

    expect(applyButton).toBeDisabled();
    expect(screen.getByTestId('option-feed')).toBeChecked();
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,150');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        presetId: 'preset-hero'
      })
    );
  });

  it('should prioritise structured pricing base values for single-select groups', () => {
    const structuredGroups: ConfiguratorOptionGroup[] = [
      {
        id: 'package',
        name: 'Package',
        type: 'single',
        required: true,
        options: [
          {
            id: 'standard',
            label: 'Standard',
            priceDelta: 0,
            recommended: true,
            structuredPricing: {
              amount: 1,
              amountUnit: 'package',
              basePrice: 1500,
              unitPrice: 1500
            }
          },
          {
            id: 'premium',
            label: 'Premium',
            priceDelta: 0,
            structuredPricing: {
              amount: 1,
              amountUnit: 'package',
              basePrice: 1800,
              unitPrice: 1800
            }
          }
        ]
      }
    ];

    render(
      <ProductConfigurator
        basePrice={1000}
        currency="EUR"
        optionGroups={structuredGroups}
        addOns={[]}
      />
    );

    // Recommended option should apply structured base price (1500) instead of raw base price.
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,500');

    // Switching to premium should use its structured pricing (1800).
    fireEvent.click(screen.getByText('Premium'));
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,800');
  });

  it('should add structured pricing amounts for multi-select groups', () => {
    const structuredGroups: ConfiguratorOptionGroup[] = [
      {
        id: 'format',
        name: 'Format',
        type: 'single',
        required: true,
        options: [
          {
            id: 'story',
            label: 'Story Ads',
            priceDelta: 0,
            recommended: true,
            structuredPricing: {
              amount: 1,
              amountUnit: 'package',
              basePrice: 1000,
              unitPrice: 1000
            }
          }
        ]
      },
      {
        id: 'extras',
        name: 'Extras',
        type: 'multiple',
        options: [
          {
            id: 'boost',
            label: 'Boost reach',
            priceDelta: 0,
            structuredPricing: {
              amount: 1,
              amountUnit: 'addon',
              basePrice: 250,
              unitPrice: 250
            }
          }
        ]
      }
    ];

    render(
      <ProductConfigurator
        basePrice={1000}
        currency="EUR"
        optionGroups={structuredGroups}
        addOns={[]}
      />
    );

    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,000');
    fireEvent.click(screen.getByText('Boost reach'));
    expect(screen.getByTestId('total-price')).toHaveTextContent('€1,250');
  });

  it('renders blueprint metadata preview when option metadata is available', () => {
    const blueprintGroups: ConfiguratorOptionGroup[] = [
      {
        id: 'blueprint',
        name: 'Blueprint Packages',
        type: 'single',
        required: true,
        options: [
          {
            id: 'starter',
            label: 'Starter',
            priceDelta: 0,
            structuredPricing: {
              amount: 100,
              amountUnit: 'followers',
              basePrice: 3,
              unitPrice: 0.03
            },
            metadata: {
              marketingTagline: '100 followers for €3',
              fulfillmentSla: 'Delivery in 3 days',
              heroImageUrl: 'https://example.com/hero.jpg',
              calculator: {
                expression: 'amount / days',
                sampleAmount: 100,
                sampleDays: 5
              }
            }
          }
        ]
      }
    ];

    render(
      <ProductConfigurator
        basePrice={1000}
        currency="EUR"
        optionGroups={blueprintGroups}
        addOns={[]}
      />
    );

    expect(screen.getByText('100 followers for €3')).toBeInTheDocument();
    expect(screen.getByText(/Delivery in 3 days/i)).toBeInTheDocument();
    expect(screen.getByText(/Expr:/i)).toBeInTheDocument();
    expect(screen.getByText(/Sample 20/)).toBeInTheDocument();
    expect(screen.getByAltText('Starter hero')).toBeInTheDocument();
  });

  it('applies default custom field values and emits them via onChange', async () => {
    const onChange = jest.fn();
    render(
      <ProductConfigurator
        basePrice={500}
        currency="USD"
        optionGroups={[]}
        addOns={[]}
        customFields={[
          {
            id: 'website',
            label: 'Brand Website',
            type: 'url',
            required: false,
            defaultValue: 'https://brand.example'
          }
        ]}
        onChange={onChange}
      />
    );

    const input = await screen.findByLabelText(/Brand Website/i);
    expect(input).toHaveValue('https://brand.example');

    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall?.customFieldValues).toEqual({ website: 'https://brand.example' });
  });

  it('toggles custom field visibility based on add-on conditions', async () => {
    const onChange = jest.fn();
    render(
      <ProductConfigurator
        basePrice={1000}
        currency="USD"
        optionGroups={[
          { id: 'bundle-tier', name: 'Bundle tier', type: 'single', required: true, options: [{ id: 'basic', label: 'Basic', priceDelta: 0 }] }
        ]}
        addOns={[
          {
            id: 'analytics',
            label: 'Performance analytics',
            description: 'Weekly reporting',
            priceDelta: 80,
            metadata: { editorKey: 'analytics-addon' },
            metadataJson: { editorKey: 'analytics-addon' },
            pricing: { mode: 'flat', amount: 80 },
            computedDelta: 80,
            percentageMultiplier: null
          }
        ]}
        customFields={[
          {
            id: 'instagram-handle',
            label: 'Instagram Handle',
            type: 'text',
            required: true,
            defaultValue: '@brand',
            conditional: {
              mode: 'all',
              conditions: [{ kind: 'addOn', addOnId: 'analytics' }]
            }
          }
        ]}
        onChange={onChange}
      />
    );

    expect(screen.queryByLabelText(/Instagram Handle/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Performance analytics'));

    const input = await screen.findByLabelText(/Instagram Handle/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('@brand');

    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall?.customFieldValues).toEqual({ 'instagram-handle': '@brand' });
  });

  it('surfaces provider margin insights for service override add-ons', () => {
    render(
      <ProductConfigurator
        basePrice={500}
        currency="USD"
        optionGroups={[]}
        addOns={[
          {
            id: 'provider-boost',
            label: 'Provider boost',
            description: 'Accelerate via preferred provider',
            priceDelta: 150,
            metadata: { editorKey: 'provider-boost' },
            metadataJson: { editorKey: 'provider-boost' },
            pricing: {
              mode: 'serviceOverride',
              amount: 150,
              providerCostAmount: 80,
              providerCostCurrency: 'USD',
              serviceDescriptor: {
                metadata: {
                  guardrails: { minimumMarginPercent: 20 },
                  costModel: { kind: 'flat', amount: 80, currency: 'USD' }
                }
              }
            },
            computedDelta: 150,
            percentageMultiplier: null
          }
        ]}
      />
    );

    const marginBadge = screen.getByTestId('addon-provider-boost-margin');
    expect(marginBadge).toHaveTextContent('Healthy');
    expect(marginBadge).toHaveTextContent('$70');
    expect(screen.getAllByText(/Cost \$80/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('addon-provider-boost-fx-warning')).toBeNull();
  });

  it('flags FX conversion and channel conflicts when add-ons lack coverage', () => {
    render(
      <ProductConfigurator
        basePrice={700}
        currency="EUR"
        optionGroups={[]}
        addOns={[
          {
            id: 'global-boost',
            label: 'Global provider boost',
            description: 'Runs on external marketplace',
            priceDelta: 180,
            metadata: { editorKey: 'global-boost' },
            metadataJson: { editorKey: 'global-boost' },
            pricing: {
              mode: 'serviceOverride',
              amount: 180,
              providerCostAmount: 120,
              providerCostCurrency: 'USD',
              serviceDescriptor: {
                metadata: {
                  guardrails: { minimumMarginPercent: 30 },
                  costModel: { kind: 'flat', amount: 120, currency: 'USD' }
                },
                defaultCurrency: 'USD'
              },
              serviceRules: [
                {
                  id: 'ig-only',
                  label: 'Instagram only',
                  conditions: [{ kind: 'channel', channels: ['instagram'] }],
                  overrides: { serviceId: 'svc-instagram' }
                }
              ]
            },
            computedDelta: 180,
            percentageMultiplier: null
          }
        ]}
        activeChannel="storefront"
        fxRates={{}}
      />
    );

    expect(screen.getByTestId('addon-global-boost-fx-warning')).toHaveTextContent('FX conversion');
    expect(screen.getByTestId('addon-global-boost-conflicts')).toHaveTextContent('Not available for STOREFRONT channel');
  });

  it('resolves FX conversion when rate table is provided', () => {
    render(
      <ProductConfigurator
        basePrice={700}
        currency="EUR"
        optionGroups={[]}
        addOns={[
          {
            id: 'global-boost',
            label: 'Global provider boost',
            description: 'Runs on external marketplace',
            priceDelta: 180,
            metadata: { editorKey: 'global-boost' },
            metadataJson: { editorKey: 'global-boost' },
            pricing: {
              mode: 'serviceOverride',
              amount: 180,
              providerCostAmount: 120,
              providerCostCurrency: 'USD',
              serviceDescriptor: {
                metadata: {
                  guardrails: { minimumMarginPercent: 30 },
                  costModel: { kind: 'flat', amount: 120, currency: 'USD' }
                },
                defaultCurrency: 'USD'
              },
              serviceRules: []
            },
            computedDelta: 180,
            percentageMultiplier: null
          }
        ]}
        activeChannel="storefront"
        fxRates={{ USD: { EUR: 0.9, USD: 1 }, EUR: { USD: 1.11, EUR: 1 } }}
      />
    );

    expect(screen.queryByTestId('addon-global-boost-fx-warning')).toBeNull();
    expect(screen.getByTestId('addon-global-boost-margin')).toHaveTextContent('Healthy');
  });
});
