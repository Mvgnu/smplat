import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ProductConfigurator, type ConfiguratorOptionGroup } from '../product-configurator';

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
  { id: 'analytics', label: 'Advanced Analytics', priceDelta: 50 },
  { id: 'reporting', label: 'Custom Reports', priceDelta: 75 }
];

describe('ProductConfigurator', () => {
  const defaultProps = {
    basePrice: 1000,
    currency: 'EUR',
    optionGroups: mockOptionGroups,
    addOns: mockAddOns,
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
      customFieldValues: {}
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
    const subscriptionPlans = [
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
    const customFields = [
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
});
