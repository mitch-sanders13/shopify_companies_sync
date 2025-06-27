/**
 * Google Sheets Service
 * 
 * This service handles authentication with Google Sheets API using a service account
 * and reads structured company and customer data from a specified spreadsheet.
 * 
 * Expected Sheet Structure (25 columns):
 * A: Company ID | B: Company Name | C: Location ID | D: Attention | E: Address | F: Address 2 | G: City | 
 * H: State | I: Zip | J: Country | K: Customer Email | L: Customer First Name | M: Customer Last Name | 
 * N: Customer Role | O: Price Level | P: Terms | Q: Currency Code | R: Sales Rep | S: Tax Details |
 * T: CC Hold | U: AR Red Flag | V: Email of Primary Contact | W: Email of Billing Contact | X: Email of Billing Contact 2 |
 * Y: Location Name
 */

const { google } = require('googleapis');
const path = require('path');

class SheetsService {
  constructor() {
    // Initialize Google Sheets API client
    this.sheets = null;
    this.auth = null;
  }

  /**
   * Authenticate with Google Sheets API using service account credentials
   * Sets up the authentication and sheets client for subsequent API calls
   */
  async authenticate() {
    try {
      const credentialsPath = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
      
      if (!credentialsPath) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS environment variable is required');
      }

      // Create auth client using service account credentials
      this.auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
      });

      // Initialize sheets client
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      
      console.log('✅ Successfully authenticated with Google Sheets API');
    } catch (error) {
      console.error('❌ Failed to authenticate with Google Sheets:', error.message);
      throw error;
    }
  }

  /**
   * Read data from the specified Google Sheet and return structured JSON
   * 
   * @returns {Array} Array of objects containing company and customer data with extended fields
   * Format: [{ companyId, companyName, locationId, address: {...}, customer: {...}, businessInfo: {...} }, ...]
   */
  async readSheetData() {
    try {
      if (!this.sheets) {
        await this.authenticate();
      }

      const spreadsheetId = process.env.GOOGLE_SHEET_ID;
      const sheetName = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
      
      if (!spreadsheetId) {
        throw new Error('GOOGLE_SHEET_ID environment variable is required');
      }

      console.log(`📊 Reading data from Google Sheet: ${spreadsheetId}`);

      // Read all data from the sheet - expanded to include all 25 columns (A-Y)
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A2:Y`,
      });

      const rows = response.data.values || [];
      
      if (rows.length === 0) {
        console.log('⚠️  No data found in the sheet');
        return [];
      }

      console.log(`📋 Found ${rows.length} rows of data`);

      // Debug: Log the first few rows to see what we're actually getting
      console.log('\n🔍 DEBUG: Raw sheet data (first 2 rows):');
      rows.slice(0, 2).forEach((row, index) => {
        console.log(`Row ${index + 1}:`, row);
        console.log(`  Length: ${row.length} columns`);
        console.log(`  Company Name (B): "${row[1] || 'EMPTY'}"`);
        console.log(`  Customer Email (K): "${row[10] || 'EMPTY'}"`);
        console.log(`  Customer First Name (L): "${row[11] || 'EMPTY'}"`);
        console.log(`  Customer Last Name (M): "${row[12] || 'EMPTY'}"`);
      });
      console.log('');

      // Transform raw sheet data into structured format
      return this.transformSheetData(rows);

    } catch (error) {
      console.error('❌ Failed to read sheet data:', error.message);
      throw error;
    }
  }

  /**
   * Transform raw sheet rows into structured company/customer objects with extended fields
   * 
   * @param {Array} rows - Raw rows from Google Sheets
   * @returns {Array} Structured data array with enhanced business information
   */
  transformSheetData(rows) {
    const structuredData = [];
    const companyLocationTracker = new Map(); // Track Company ID + Location ID combinations
    const companyIdTracker = new Set(); // Track unique Company IDs for statistics
    const validationErrors = [];

    console.log('🔍 Starting data validation and transformation...\n');

    rows.forEach((row, index) => {
      const rowNumber = index + 2; // Account for header row
      
      try {
        // Skip empty rows
        if (!row || row.length === 0) {
          console.log(`⚠️  Row ${rowNumber}: Empty row, skipping`);
          return;
        }

        // Map all 25 columns to variables
        const [
          companyId,           // A
          companyName,         // B  
          locationId,          // C
          attention,           // D
          address,             // E
          address2,            // F
          city,                // G
          state,               // H
          zip,                 // I
          country,             // J
          customerEmail,       // K
          customerFirstName,   // L
          customerLastName,    // M
          customerRole,        // N
          priceLevel,          // O
          terms,               // P
          currencyCode,        // Q
          salesRep,            // R
          taxDetails,          // S
          ccHold,              // T
          arRedFlag,           // U
          emailPrimaryContact, // V
          emailBillingContact, // W
          emailBillingContact2,// X
          locationName         // Y
        ] = row;

        // Enhanced validation for required fields
        const trimmedCompanyId = companyId?.trim();
        const trimmedCompanyName = companyName?.trim();
        const trimmedLocationId = locationId?.trim();
        const trimmedCustomerEmail = customerEmail?.trim();
        const trimmedCustomerFirstName = customerFirstName?.trim();
        const trimmedCustomerLastName = customerLastName?.trim();

        // Check for required fields - now including Company ID and Location ID
        const missingFields = [];
        if (!trimmedCompanyId) missingFields.push('Company ID (Column A)');
        if (!trimmedCompanyName) missingFields.push('Company Name (Column B)');
        if (!trimmedLocationId) missingFields.push('Location ID (Column C)');
        if (!trimmedCustomerEmail) missingFields.push('Customer Email (Column K)');
        if (!trimmedCustomerFirstName) missingFields.push('Customer First Name (Column L)');
        if (!trimmedCustomerLastName) missingFields.push('Customer Last Name (Column M)');

        if (missingFields.length > 0) {
          const errorMsg = `Row ${rowNumber}: Missing required fields: ${missingFields.join(', ')}`;
          console.warn(`⚠️  ${errorMsg}`);
          validationErrors.push(errorMsg);
          return;
        }

        // Validate Company ID format (ensure it's not just whitespace)
        if (trimmedCompanyId.length === 0) {
          const errorMsg = `Row ${rowNumber}: Company ID cannot be empty or whitespace only`;
          console.warn(`⚠️  ${errorMsg}`);
          validationErrors.push(errorMsg);
          return;
        }

        // Validate Location ID format (ensure it's not just whitespace)
        if (trimmedLocationId.length === 0) {
          const errorMsg = `Row ${rowNumber}: Location ID cannot be empty or whitespace only`;
          console.warn(`⚠️  ${errorMsg}`);
          validationErrors.push(errorMsg);
          return;
        }

        // Create compound key for Company ID + Location ID combination
        const companyLocationKey = `${trimmedCompanyId}|${trimmedLocationId}`;
        
        // Check for duplicate Company ID + Location ID combinations
        if (companyLocationTracker.has(companyLocationKey)) {
          const previousRow = companyLocationTracker.get(companyLocationKey);
          const errorMsg = `Row ${rowNumber}: Duplicate Company ID + Location ID combination "${trimmedCompanyId}" + "${trimmedLocationId}" (first seen in row ${previousRow})`;
          console.warn(`⚠️  ${errorMsg}`);
          validationErrors.push(errorMsg);
          // Note: We'll still process this row but flag it as a duplicate
        } else {
          companyLocationTracker.set(companyLocationKey, rowNumber);
        }

        // Track unique Company IDs for statistics (this is OK to have duplicates)
        companyIdTracker.add(trimmedCompanyId);

        // Validate email format (basic validation)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmedCustomerEmail)) {
          const errorMsg = `Row ${rowNumber}: Invalid email format "${trimmedCustomerEmail}"`;
          console.warn(`⚠️  ${errorMsg}`);
          validationErrors.push(errorMsg);
          return;
        }

        // Create enhanced structured object with all new fields (flattened for easier access)
        const dataObject = {
          // Company identification
          companyId: trimmedCompanyId,
          companyName: trimmedCompanyName,
          locationId: trimmedLocationId,
          
          // Address information (flattened)
          attention: attention?.trim() || '',
          address: address?.trim() || '',
          address2: address2?.trim() || '',
          city: city?.trim() || '',
          state: state?.trim() || '',
          zip: zip?.trim() || '',
          country: country?.trim() || 'United States', // Default to US, can be made configurable
          
          // Customer information (flattened)
          customerEmail: trimmedCustomerEmail.toLowerCase(),
          customerFirstName: trimmedCustomerFirstName,
          customerLastName: trimmedCustomerLastName,
          customerRole: customerRole?.trim().toUpperCase() || 'MEMBER', // Default role
          
          // Business/commercial information (flattened)
          priceLevel: priceLevel?.trim() || '',
          terms: terms?.trim() || '',
          currencyCode: currencyCode?.trim().toUpperCase() || 'USD', // Default to USD
          salesRep: salesRep?.trim() || '',
          taxDetails: taxDetails?.trim() || '',
          
          // Location information
          locationName: locationName?.trim() || '',
          
          // Company metafields (boolean and email)
          ccHold: ccHold?.trim().toLowerCase() === 'true' || false,
          arRedFlag: arRedFlag?.trim().toLowerCase() === 'true' || false,
          emailPrimaryContact: emailPrimaryContact?.trim() || '',
          emailBillingContact: emailBillingContact?.trim() || '',
          emailBillingContact2: emailBillingContact2?.trim() || '',
          
          // Metadata for tracking
          _sourceRow: rowNumber,
          _companyLocationKey: companyLocationKey,
          _isDuplicate: companyLocationTracker.get(companyLocationKey) !== rowNumber
        };

        structuredData.push(dataObject);

      } catch (error) {
        const errorMsg = `Row ${rowNumber}: Error processing data - ${error.message}`;
        console.error(`❌ ${errorMsg}`);
        validationErrors.push(errorMsg);
      }
    });

    // Display validation summary
    console.log('\n📊 VALIDATION SUMMARY:');
    console.log('─'.repeat(60));
    console.log(`✅ Successfully processed: ${structuredData.length} records`);
    console.log(`❌ Validation errors: ${validationErrors.length}`);
    console.log(`🏢 Unique Company IDs found: ${companyIdTracker.size}`);
    console.log(`📍 Unique Company+Location combinations: ${companyLocationTracker.size}`);
    
    // Check for duplicate Company+Location combinations
    const duplicateCompanyLocations = Array.from(companyLocationTracker.entries())
      .filter(([companyLocationKey, _]) => 
        structuredData.filter(record => record._companyLocationKey === companyLocationKey).length > 1
      );
    
    if (duplicateCompanyLocations.length > 0) {
      console.log(`⚠️  Duplicate Company+Location combinations detected: ${duplicateCompanyLocations.length}`);
      duplicateCompanyLocations.forEach(([companyLocationKey, firstRow]) => {
        const [companyId, locationId] = companyLocationKey.split('|');
        const duplicateRows = structuredData
          .filter(record => record._companyLocationKey === companyLocationKey)
          .map(record => record._sourceRow);
        console.log(`   - Company "${companyId}" + Location "${locationId}": Rows ${duplicateRows.join(', ')}`);
      });
    } else {
      console.log(`✅ No duplicate Company+Location combinations found`);
    }
    
    if (validationErrors.length > 0) {
      console.log('\n❌ VALIDATION ERRORS:');
      validationErrors.forEach(error => console.log(`   - ${error}`));
      console.log('\n💡 Please fix the above errors in your Google Sheet before running the sync.');
    }
    
    console.log('─'.repeat(60));
    console.log('');

    return structuredData;
  }

  /**
   * Get a summary of the data structure for validation and debugging
   * 
   * @param {Array} data - Structured data from transformSheetData
   * @returns {Object} Summary statistics of the data
   */
  getDataSummary(data) {
    if (!data || data.length === 0) {
      return { totalRecords: 0 };
    }

    const summary = {
      totalRecords: data.length,
      companiesWithId: data.filter(d => d.companyId).length,
      locationsWithId: data.filter(d => d.locationId).length,
      recordsWithPriceLevel: data.filter(d => d.priceLevel).length,
      recordsWithTerms: data.filter(d => d.terms).length,
      recordsWithSalesRep: data.filter(d => d.salesRep).length,
      recordsWithTaxDetails: data.filter(d => d.taxDetails).length,
      uniqueCompanies: [...new Set(data.map(d => d.companyName))].length,
      uniqueCustomers: [...new Set(data.map(d => d.customerEmail))].length,
      currencyCodes: [...new Set(data.map(d => d.currencyCode))],
      customerRoles: [...new Set(data.map(d => d.customerRole))]
    };

    return summary;
  }

  /**
   * Validate that all required environment variables are set
   * 
   * @returns {boolean} True if all required variables are present
   */
  static validateConfig() {
    const required = [
      'GOOGLE_SHEET_ID',
      'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS'
    ];

    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:', missing.join(', '));
      return false;
    }

    return true;
  }
}

module.exports = SheetsService; 