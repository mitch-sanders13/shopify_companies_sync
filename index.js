/**
 * Shopify B2B Companies Sync - Enhanced Location Architecture
 * 
 * This application synchronizes company, location, and customer data from Google Sheets to Shopify.
 * Enhanced to support the new architecture where each row represents a location linked to a company.
 * 
 * New Flow:
 * 1. Each row in Google Sheets represents a location (not just a company)
 * 2. Company ID (Column A) is used to find/create companies
 * 3. Location ID (Column C) is used to find/create locations  
 * 4. Companies can have multiple locations
 * 5. Customers are linked to both companies and locations
 * 
 * Required Environment Variables:
 * - GOOGLE_SHEETS_SPREADSHEET_ID: Google Sheets spreadsheet ID
 * - GOOGLE_APPLICATION_CREDENTIALS: Path to Google service account credentials
 * - SHOPIFY_STORE_DOMAIN: Your Shopify store domain
 * - SHOPIFY_ADMIN_TOKEN: Shopify Admin API access token
 * - SHOPIFY_API_VERSION: Shopify API version (e.g., 2024-04)
 */

// Load environment variables first
require('dotenv').config();

// Import services
const SyncService = require('./services/syncService');

/**
 * Main execution function
 * Handles the application lifecycle and error management
 */
async function main() {
  console.log('🚀 Shopify B2B Sync - Enhanced Location Architecture');
  console.log('====================================================');
  console.log('📋 Architecture: Row = Location → Company → Customer');
  console.log('====================================================\n');

  try {
    // Initialize sync service
    const syncService = new SyncService();
    
    // Validate configuration before starting
    console.log('🔧 Validating configuration...');
    if (!syncService.validateConfiguration()) {
      console.error('❌ Configuration validation failed. Please check your environment variables.');
      process.exit(1);
    }
    console.log('✅ Configuration valid\n');

    // Check if this is a dry run
    const isDryRun = process.env.DRY_RUN === 'true';
    
    if (isDryRun) {
      console.log('🧪 DRY RUN MODE: No changes will be made to Shopify\n');
      // For dry run, we could implement a preview mode in the future
      console.log('⚠️  Dry run mode not yet implemented for the new architecture');
      console.log('   Remove DRY_RUN=true to run the actual sync');
      return;
    }

    console.log('🔄 Starting sync process...\n');
    
    // Execute the enhanced sync process
    const startTime = Date.now();
    const results = await syncService.executeSync();
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    // Display final summary
    console.log('\n' + '='.repeat(60));
    console.log('🎊 SYNC PROCESS COMPLETED!');
    console.log('='.repeat(60));
    console.log(`⏱️  Total Duration: ${duration} seconds`);
    console.log(`📊 Total Rows Processed: ${results.processed}`);
    console.log(`❌ Total Errors: ${results.errors}`);
    
    if (results.errors === 0) {
      console.log('🌟 Perfect sync! All rows processed successfully.');
      process.exit(0);
    } else if (results.processed > 0) {
      console.log('⚠️  Partial sync completed. Some rows had errors.');
      process.exit(1);
    } else {
      console.error('💥 Sync failed completely. No rows were processed.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 Fatal error during sync process:');
    console.error('Error:', error.message);
    
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    console.error('\n🔧 Troubleshooting:');
    console.error('1. Check your environment variables');
    console.error('2. Verify Google Sheets access permissions');
    console.error('3. Confirm Shopify API credentials and permissions');
    console.error('4. Ensure your Shopify store has B2B features enabled (Shopify Plus required)');
    
    process.exit(1);
  }
}

/**
 * Display current configuration (without sensitive information)
 */
function displayConfiguration() {
  console.log('⚙️  CONFIGURATION:');
  console.log(`   Shopify Store: ${process.env.SHOPIFY_STORE_DOMAIN || 'NOT SET'}`);
  console.log(`   Shopify API Version: ${process.env.SHOPIFY_API_VERSION || 'NOT SET'}`);
  console.log(`   Google Sheet ID: ${process.env.GOOGLE_SHEET_ID ? '***' + process.env.GOOGLE_SHEET_ID.slice(-8) : 'NOT SET'}`);
  console.log(`   Google Sheet Name: ${process.env.GOOGLE_SHEET_NAME || 'Sheet1 (default)'}`);
  console.log(`   Service Account File: ${process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS || 'NOT SET'}`);
  console.log(`   Debug Mode: ${process.env.DEBUG === 'true' ? 'ON' : 'OFF'}`);
  console.log(`   Dry Run Mode: ${process.env.DRY_RUN === 'true' ? 'ON' : 'OFF'}`);
  console.log('=' .repeat(60));
}

/**
 * Handle uncaught exceptions and unhandled rejections
 */
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error.message);
  if (process.env.DEBUG === 'true') {
    console.error('Full error details:', error);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  if (process.env.DEBUG === 'true') {
    console.error('Full error details:', reason);
  }
  process.exit(1);
});

/**
 * Handle graceful shutdown
 */
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

// Start the application
if (require.main === module) {
  main();
}

module.exports = { main }; 