# Shopify B2B Sync Integration

Automate the creation and linking of companies and customers in Shopify based on data stored in a Google Sheet.

## Overview

This Node.js application synchronizes company and customer data from Google Sheets to Shopify's B2B system using the GraphQL Admin API. It handles:

- ✅ Reading structured company + customer data from Google Sheets
- ✅ Creating companies using Shopify's B2B GraphQL API  
- ✅ Creating customers and linking them to companies as contacts
- ✅ Avoiding duplicates via basic matching logic (by name or email)
- ✅ Comprehensive error handling and logging
- ✅ Rate limiting protection

## Prerequisites

- **Node.js 14.0.0 or higher**
- **Shopify Plus account** (required for B2B company features)
- **Google Cloud Project** with Sheets API enabled
- **Service account credentials** for Google Sheets access

## Tech Stack

- **Node.js** - Runtime environment
- **Shopify GraphQL Admin API** - For B2B company and customer management
- **Google Sheets API** - For reading spreadsheet data
- **Axios** - HTTP client for API requests
- **Googleapis** - Google API client library

## Project Structure

```
shopify-b2b-sync/
├── .env.example              # Environment variables template
├── .gitignore               # Git ignore patterns
├── credentials.json.example # Google service account template
├── package.json             # Dependencies and scripts
├── README.md                # This file
├── index.js                 # Main entry point
├── services/                # Business logic services
│   ├── sheetsService.js     # Google Sheets API integration
│   ├── shopifyService.js    # Shopify GraphQL API calls
│   └── syncService.js       # Main sync orchestration logic
└── utils/                   # Utility functions
    └── gqlHelper.js         # GraphQL query/mutation builders
```

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd shopify-b2b-sync
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your configuration:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
# Shopify Configuration
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_your_admin_token_here
SHOPIFY_API_VERSION=2024-04

# Google Sheets Configuration
GOOGLE_SHEET_ID=your_google_sheet_id_here
GOOGLE_SERVICE_ACCOUNT_CREDENTIALS=./credentials.json
GOOGLE_SHEET_NAME=Sheet1

# Optional Settings
DEBUG=false
```

### 3. Set Up Google Sheets API

1. **Create a Google Cloud Project** (if you don't have one)
2. **Enable the Google Sheets API** in your project
3. **Create a Service Account**:
   - Go to IAM & Admin > Service Accounts
   - Click "Create Service Account"
   - Give it a name and description
   - Create and download the JSON key file
4. **Share your Google Sheet** with the service account email
5. **Rename the credentials file** to `credentials.json` and place it in your project root

### 4. Set Up Shopify App

1. **Create a Custom App** in your Shopify Admin:
   - Go to Settings > Apps and sales channels > Develop apps
   - Click "Create an app"
   - Give it a name and select necessary scopes
2. **Configure API Scopes** - Your app needs these permissions:
   - `read_customers`, `write_customers`
   - `read_companies`, `write_companies`
   - `read_company_contacts`, `write_company_contacts`
3. **Generate Admin API Access Token**
4. **Copy the token** to your `.env` file

### 5. Prepare Your Google Sheet

Your Google Sheet should have the following column structure (row 1 should be headers):

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Company ID | Company Name | Location ID | Address | City | State | Zip | Customer Email | Customer First Name | Customer Last Name | Customer Role | Price Level | Terms | Currency Code | Sales Rep | Tax Details |

**Example data:**
```
COMP001 | Acme Inc | LOC001 | 123 Main St | New York | NY | 10001 | john@acme.com | John | Doe | ADMIN | Premium | Net30 | USD | Sarah Johnson | Tax Exempt
COMP002 | Tech Corp | LOC002 | 456 Oak Ave | Austin | TX | 78701 | jane@techcorp.com | Jane | Smith | MEMBER | Standard | Net15 | USD | Mike Davis | Standard Tax
```

**Column Descriptions:**
- **Company ID** (A): Optional unique identifier for the company
- **Company Name** (B): Required - Name of the company
- **Location ID** (C): Optional location identifier
- **Address** (D): Company street address
- **City** (E): Company city
- **State** (F): Company state/province
- **Zip** (G): Company postal/zip code
- **Customer Email** (H): Required - Customer's email address
- **Customer First Name** (I): Required - Customer's first name
- **Customer Last Name** (J): Required - Customer's last name
- **Customer Role** (K): Customer's role in the company (ADMIN, MEMBER, etc.)
- **Price Level** (L): Customer's pricing tier (Premium, Standard, etc.)
- **Terms** (M): Payment terms (Net30, Net15, etc.)
- **Currency Code** (N): Transaction currency (USD, EUR, CAD, etc.)  
- **Sales Rep** (O): Assigned sales representative
- **Tax Details** (P): Tax classification or notes

## Usage

### Basic Usage

Run the synchronization:

```bash
npm start
```

### Development Mode

Run with detailed logging:

```bash
DEBUG=true npm start
```

### Dry Run Mode

Test without making actual changes:

```bash
DRY_RUN=true npm start
```

## How It Works

1. **Authentication**: Connects to Google Sheets API using service account credentials
2. **Data Reading**: Reads structured data from your specified Google Sheet
3. **Data Processing**: For each row in the sheet:
   - Checks if the company already exists (by name)
   - Creates company if it doesn't exist
   - Checks if the customer already exists (by email)
   - Creates customer if it doesn't exist
   - Links the customer to the company with the specified role
4. **Error Handling**: Continues processing even if individual records fail
5. **Reporting**: Provides detailed statistics at completion

## Configuration Options

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `SHOPIFY_STORE_DOMAIN` | Yes | Your Shopify store domain | - |
| `SHOPIFY_ADMIN_TOKEN` | Yes | Admin API access token | - |
| `SHOPIFY_API_VERSION` | Yes | Shopify API version | `2024-04` |
| `GOOGLE_SHEET_ID` | Yes | Google Sheet ID from URL | - |
| `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` | Yes | Path to credentials file | `./credentials.json` |
| `GOOGLE_SHEET_NAME` | No | Sheet name/tab | `Sheet1` |
| `DEBUG` | No | Enable debug logging | `false` |
| `DRY_RUN` | No | Run without making changes | `false` |

### Customer Roles

The application supports these customer roles in companies:
- `ADMIN` - Full company access
- `MEMBER` - Basic company access  
- Custom roles (as configured in your Shopify B2B settings)

## Troubleshooting

### Common Issues

**❌ "Authentication failed with Google Sheets"**
- Verify your `credentials.json` file is valid and in the correct location
- Ensure the service account email has access to your Google Sheet
- Check that the Google Sheets API is enabled in your Google Cloud Project

**❌ "GraphQL Error: Access denied"**
- Verify your Shopify Admin API token is correct
- Ensure your app has the required API scopes
- Confirm your store has Shopify Plus (required for B2B features)

**❌ "Company creation errors"**
- Check that company names are unique
- Verify required fields are present in your sheet data
- Ensure your Shopify B2B settings are configured correctly

**❌ "No data found in the sheet"**
- Verify the sheet name/tab is correct
- Check that your data starts in row 2 (row 1 should be headers)
- Ensure the Google Sheet ID is correct

### Debug Mode

Enable debug mode for detailed logging:

```bash
DEBUG=true npm start
```

This will show:
- Full API request/response details
- Detailed error stack traces
- Processing information for each record

### Dry Run Mode

Test your configuration without making changes:

```bash
DRY_RUN=true npm start
```

## Rate Limiting

The application includes built-in rate limiting protection:
- 500ms delay between API calls
- Graceful error handling for rate limit responses
- Automatic retry logic for transient failures

## Security Considerations

- Never commit your `.env` file or `credentials.json` to version control
- Use environment-specific service accounts
- Regularly rotate your API tokens
- Follow the principle of least privilege for app permissions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review the [Shopify GraphQL Admin API documentation](https://shopify.dev/docs/admin-api/graphql)
3. Check the [Google Sheets API documentation](https://developers.google.com/sheets/api)

## License

MIT License - see LICENSE file for details.

---

**⚠️ Important Notes:**
- This integration requires Shopify Plus for B2B company features
- All company-related GraphQL mutations are available only in the Shopify Admin GraphQL API (not REST)
- Test thoroughly in a development environment before running in production 