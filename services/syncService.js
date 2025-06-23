/**
 * Sync Service
 * 
 * This service orchestrates the synchronization process between Google Sheets and Shopify.
 * Enhanced flow: Company → Customer → Location → Assignment
 * 
 * New Flow:
 * 1. Find/Create Company (using Company ID)
 * 2. Find/Create Customer (using email)
 * 3. Link Customer to Company (as company contact)
 * 4. Find/Create Location (using Location ID, linked to company)
 * 5. Assign Customer to Location
 * 
 * This allows companies to have multiple locations with customers assigned to specific locations.
 */

const SheetsService = require('./sheetsService');
const ShopifyService = require('./shopifyService');

class SyncService {
  constructor() {
    this.sheetsService = new SheetsService();
    this.shopifyService = new ShopifyService();
    this.stats = {
      processed: 0,
      companiesCreated: 0,
      companiesFound: 0,
      customersCreated: 0,
      customersFound: 0,
      locationsCreated: 0,
      locationsFound: 0,
      contactsCreated: 0,
      locationAssignments: 0,
      errors: 0
    };
  }

  /**
   * Validate that all required configuration is present
   * @returns {boolean} True if configuration is valid
   */
  validateConfiguration() {
    const requiredEnvVars = [
      'SHOPIFY_STORE_DOMAIN',
      'SHOPIFY_ADMIN_TOKEN',
      'SHOPIFY_API_VERSION',
      'GOOGLE_SHEET_ID',
      'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS'
    ];

    let isValid = true;
    const missingVars = [];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        missingVars.push(envVar);
        isValid = false;
      }
    }

    if (!isValid) {
      console.error('❌ Missing required environment variables:');
      missingVars.forEach(varName => {
        console.error(`   - ${varName}`);
      });
      console.error('\n💡 Please check your .env file and ensure all required variables are set.');
    }

    return isValid;
  }

  /**
   * Validate sheet data for critical issues before starting sync
   * @param {Array} sheetData - Processed sheet data
   * @returns {Object} Validation result with isValid flag and errors array
   */
  validateSheetData(sheetData) {
    const errors = [];
    const companyIds = new Set();
    const companyLocationCombos = new Set();
    
    // Check for missing Company IDs and Location IDs
    const missingCompanyIds = sheetData.filter(row => !row.companyId || row.companyId.trim() === '');
    if (missingCompanyIds.length > 0) {
      errors.push(`${missingCompanyIds.length} rows have missing Company IDs`);
    }
    
    const missingLocationIds = sheetData.filter(row => !row.locationId || row.locationId.trim() === '');
    if (missingLocationIds.length > 0) {
      errors.push(`${missingLocationIds.length} rows have missing Location IDs`);
    }
    
    // Check for duplicate Company ID + Location ID combinations (critical duplicates only)
    sheetData.forEach(row => {
      if (row.companyId && row.locationId) {
        const companyLocationKey = `${row.companyId}|${row.locationId}`;
        
        if (companyLocationCombos.has(companyLocationKey)) {
          errors.push(`Duplicate Company+Location combination found: Company "${row.companyId}" + Location "${row.locationId}"`);
        } else {
          companyLocationCombos.add(companyLocationKey);
        }
        
        // Track unique company IDs for statistics
        companyIds.add(row.companyId);
      }
    });
    
    // Check for rows marked as duplicates
    const duplicateRows = sheetData.filter(row => row._isDuplicate);
    if (duplicateRows.length > 0) {
      errors.push(`${duplicateRows.length} rows have duplicate Company+Location combinations within the sheet`);
    }
    
    return {
      isValid: errors.length === 0,
      errors: errors,
      totalRows: sheetData.length,
      uniqueCompanyIds: companyIds.size,
      uniqueLocations: companyLocationCombos.size,
      duplicateRows: duplicateRows.length
    };
  }

  /**
   * Execute the complete synchronization process
   * Flow: Company → Customer → Location → Assignment
   * @returns {Promise<Object>} Sync statistics and results
   */
  async executeSync() {
    try {
      console.log('🚀 Starting Shopify B2B sync process...');
      console.log('📋 Flow: Company → Customer → Location → Assignment\n');

      // Step 1: Initialize services
      await this.sheetsService.authenticate();
      console.log('✅ Google Sheets service initialized\n');

      // Step 2: Read data from Google Sheets
      console.log('📖 Reading data from Google Sheets...');
      const sheetData = await this.sheetsService.readSheetData();
      
      if (!sheetData || sheetData.length === 0) {
        console.log('⚠️  No data found in Google Sheets');
        return this.stats;
      }

      // Step 2.5: Validate data quality before processing
      const validationResult = this.validateSheetData(sheetData);
      if (!validationResult.isValid) {
        console.error('\n❌ Data validation failed. Cannot proceed with sync.');
        console.error('Please fix the following issues in your Google Sheet:');
        validationResult.errors.forEach(error => console.error(`   - ${error}`));
        throw new Error('Data validation failed. Please fix the issues in your Google Sheet and try again.');
      }

      console.log(`📊 Found ${sheetData.length} rows to process\n`);
      this.displayDataPreview(sheetData);

      // Step 3: Process each row
      console.log('\n🔄 Processing rows...\n');
      
      for (let i = 0; i < sheetData.length; i++) {
        const rowData = sheetData[i];
        console.log(`\n--- Processing Row ${i + 1}/${sheetData.length} ---`);
        console.log(`Company: ${rowData.companyName} (${rowData.companyId})`);
        console.log(`Customer: ${rowData.customerEmail}`);
        console.log(`Location: ${rowData.locationId}`);

        try {
          await this.processRow(rowData);
          this.stats.processed++;
        } catch (error) {
          console.error(`❌ Error processing row ${i + 1}:`, error.message);
          this.stats.errors++;
        }
      }

      // Step 4: Display final results
      this.displayFinalStats();
      
      return this.stats;
    } catch (error) {
      console.error('❌ Sync process failed:', error);
      throw error;
    }
  }

  /**
   * Process a single row with the new flow: Company → Customer → Location → Assignment
   * @param {Object} rowData - Data from a single spreadsheet row
   * @returns {Promise<void>}
   */
  async processRow(rowData) {
    // Step 1: Get or create company
    console.log('🏢 Step 1: Processing company...');
    const company = await this.shopifyService.getOrCreateCompany(rowData);
    
    if (company.createdAt === company.updatedAt) {
      this.stats.companiesCreated++;
    } else {
      this.stats.companiesFound++;
    }

    // Step 2: Get or create customer and link to company
    console.log('👤 Step 2: Processing customer...');
    const { customer, contact } = await this.shopifyService.getOrCreateCustomerAndContact(company.id, rowData);
    
    if (customer.createdAt === customer.updatedAt) {
      this.stats.customersCreated++;
    } else {
      this.stats.customersFound++;
    }
    this.stats.contactsCreated++;

    // Step 3: Get or create location
    console.log('📍 Step 3: Processing location...');
    const location = await this.shopifyService.getOrCreateLocation(company.id, rowData);
    
    if (location.createdAt === location.updatedAt) {
      this.stats.locationsCreated++;
    } else {
      this.stats.locationsFound++;
    }

    // Step 4: Assign customer to location
    if (contact && location) {
      // Skip assignment if contact is a placeholder (customer already associated with another company)
      if (!contact.id.startsWith('existing-')) {
        console.log('🔗 Step 4: Assigning customer to location...');
        const assignment = await this.shopifyService.assignCustomerToLocationIfNeeded(
          contact.id, 
          location.id, 
          rowData.customerRole
        );
        
        if (assignment) {
          this.stats.locationAssignments++;
        }
      } else {
        console.log('ℹ️  Step 4: Skipping location assignment - customer already associated with another company');
      }
    }

    console.log('✅ Row processed successfully');
  }

  /**
   * Display a preview of the data that will be processed
   * @param {Array} data - Array of row data objects
   */
  displayDataPreview(data) {
    console.log('📋 Data Preview (first 3 rows):');
    console.log('─'.repeat(120));
    console.log('| Company ID | Company Name | Location ID | Customer Email | Customer Name | Role |');
    console.log('─'.repeat(120));
    
    const preview = data.slice(0, 3);
    preview.forEach(row => {
      const companyId = (row.companyId || '').substring(0, 10);
      const companyName = (row.companyName || '').substring(0, 15);
      const locationId = (row.locationId || '').substring(0, 11);
      const email = (row.customerEmail || '').substring(0, 20);
      const name = `${row.customerFirstName || ''} ${row.customerLastName || ''}`.substring(0, 15);
      const role = (row.customerRole || '').substring(0, 8);
      
      console.log(`| ${companyId.padEnd(10)} | ${companyName.padEnd(12)} | ${locationId.padEnd(11)} | ${email.padEnd(14)} | ${name.padEnd(13)} | ${role.padEnd(4)} |`);
    });
    
    console.log('─'.repeat(120));
    
    if (data.length > 3) {
      console.log(`... and ${data.length - 3} more rows`);
    }

    // Display business information preview
    console.log('\n💼 Business Information Preview:');
    const businessPreview = data.slice(0, 2);
    businessPreview.forEach((row, index) => {
      console.log(`\nRow ${index + 1}:`);
      console.log(`  📍 Address: ${row.address}, ${row.city}, ${row.state} ${row.zip}`);
      console.log(`  💰 Price Level: ${row.priceLevel || 'N/A'}`);
      console.log(`  📋 Terms: ${row.terms || 'N/A'}`);
      console.log(`  💱 Currency: ${row.currencyCode || 'N/A'}`);
      console.log(`  👨‍💼 Sales Rep: ${row.salesRep || 'N/A'}`);
      console.log(`  🧾 Tax Details: ${row.taxDetails || 'N/A'}`);
    });
  }

  /**
   * Display final synchronization statistics
   */
  displayFinalStats() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 SYNC COMPLETED - FINAL STATISTICS');
    console.log('='.repeat(60));
    
    console.log('\n🏢 COMPANIES:');
    console.log(`   Created: ${this.stats.companiesCreated}`);
    console.log(`   Found existing: ${this.stats.companiesFound}`);
    console.log(`   Total: ${this.stats.companiesCreated + this.stats.companiesFound}`);
    
    console.log('\n👤 CUSTOMERS:');
    console.log(`   Created: ${this.stats.customersCreated}`);
    console.log(`   Found existing: ${this.stats.customersFound}`);
    console.log(`   Total: ${this.stats.customersCreated + this.stats.customersFound}`);
    
    console.log('\n📍 LOCATIONS:');
    console.log(`   Created: ${this.stats.locationsCreated}`);
    console.log(`   Found existing: ${this.stats.locationsFound}`);
    console.log(`   Total: ${this.stats.locationsCreated + this.stats.locationsFound}`);
    
    console.log('\n🔗 RELATIONSHIPS:');
    console.log(`   Company contacts created: ${this.stats.contactsCreated}`);
    console.log(`   Location assignments: ${this.stats.locationAssignments}`);
    
    console.log('\n📈 PROCESSING:');
    console.log(`   Rows processed: ${this.stats.processed}`);
    console.log(`   Errors: ${this.stats.errors}`);
    
    const successRate = this.stats.processed > 0 ? 
      ((this.stats.processed / (this.stats.processed + this.stats.errors)) * 100).toFixed(1) : 0;
    console.log(`   Success rate: ${successRate}%`);
    
    console.log('\n' + '='.repeat(60));
    
    if (this.stats.errors > 0) {
      console.log('⚠️  Some rows had errors. Check the logs above for details.');
    } else {
      console.log('🎉 All rows processed successfully!');
    }
  }

  /**
   * Get current synchronization statistics
   * @returns {Object} Current stats object
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics counters
   */
  resetStats() {
    this.stats = {
      processed: 0,
      companiesCreated: 0,
      companiesFound: 0,
      customersCreated: 0,
      customersFound: 0,
      locationsCreated: 0,
      locationsFound: 0,
      contactsCreated: 0,
      locationAssignments: 0,
      errors: 0
    };
  }
}

module.exports = SyncService; 