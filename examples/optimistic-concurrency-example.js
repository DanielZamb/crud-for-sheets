/**
 * Optimistic Concurrency Control Examples for GSDB
 * 
 * This file demonstrates various patterns for using version-based
 * optimistic locking to prevent data conflicts in Google Sheets.
 */

// ============================================================================
// SETUP: Initialize Database with Versioning
// ============================================================================

function setupDatabaseWithVersioning() {
  // Create or open your spreadsheet
  const db = new DB('My Database', 'YOUR_SPREADSHEET_ID');
  
  // Create a table with versioning enabled
  const productsConfig = {
    tableName: 'PRODUCTS',
    historyTableName: 'DELETED_PRODUCTS',
    enableVersioning: true, // Enable optimistic concurrency control
    fields: {
      name: 'string',
      price: 'number',
      stock: 'number',
      category: 'string'
    }
  };
  
  db.createTable(productsConfig);
  
  // Create another versioned table for orders
  const ordersConfig = {
    tableName: 'ORDERS',
    historyTableName: 'DELETED_ORDERS',
    enableVersioning: true,
    fields: {
      customer_name: 'string',
      product_id: 'number',
      quantity: 'number',
      total: 'number',
      status: 'string'
    }
  };
  
  db.createTable(ordersConfig);
  
  return db;
}

// ============================================================================
// EXAMPLE 1: Basic Version Check
// ============================================================================

function example1_BasicVersionCheck() {
  const db = setupDatabaseWithVersioning();
  
  // Create a product
  const createResult = db.create(
    'PRODUCTS',
    {
      name: 'Laptop',
      price: 999.99,
      stock: 10,
      category: 'Electronics'
    },
    ['name', 'price', 'stock', 'category']
  );
  
  console.log('Created product:', createResult);
  // Output: { status: 200, id: 1, action: 'created', version: 1 }
  
  const productId = createResult.id;
  
  // Read the product (includes version)
  const readResult = db.read('PRODUCTS', productId);
  console.log('Product data:', readResult.data);
  // Output: { id: 1, date: ..., version: 1, name: 'Laptop', ... }
  
  const currentVersion = readResult.data.version;
  
  // Update with version check
  const updateResult = db.update(
    'PRODUCTS',
    productId,
    {
      name: 'Laptop',
      price: 899.99, // Price reduced
      stock: 10,
      category: 'Electronics'
    },
    ['name', 'price', 'stock', 'category'],
    false, // typesChecked
    null,  // addUpdatePolicy
    currentVersion // expectedVersion - this is the key!
  );
  
  console.log('Update result:', updateResult);
  // Output: { status: 200, id: 1, action: 'updated', version: 2 }
  
  // Try to update with old version (will fail)
  const conflictResult = db.update(
    'PRODUCTS',
    productId,
    {
      name: 'Laptop',
      price: 799.99,
      stock: 10,
      category: 'Electronics'
    },
    ['name', 'price', 'stock', 'category'],
    false,
    null,
    currentVersion // Using old version 1, but current is 2
  );
  
  console.log('Conflict result:', conflictResult);
  // Output: { status: 500, error: 'Optimistic concurrency conflict: ...' }
}

// ============================================================================
// EXAMPLE 2: Retry Pattern with Exponential Backoff
// ============================================================================

/**
 * Automatically retry updates on version conflicts
 */
function updateWithRetry(db, tableName, id, updateFn, keyOrder, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Read current data
      const readResult = db.read(tableName, id);
      
      if (readResult.status !== 200) {
        return {
          success: false,
          error: `Failed to read record: ${readResult.error}`
        };
      }
      
      const currentData = readResult.data;
      const currentVersion = currentData.version;
      
      // Apply user's update function
      const updatedData = updateFn(currentData);
      
      // Attempt update with version check
      const updateResult = db.update(
        tableName,
        id,
        updatedData,
        keyOrder,
        false,
        null,
        currentVersion
      );
      
      // Success!
      if (updateResult.status === 200) {
        return {
          success: true,
          data: updateResult,
          attempts: attempt + 1
        };
      }
      
      // Check if it's a version conflict
      if (updateResult.error && updateResult.error.includes('Optimistic concurrency conflict')) {
        console.log(`Conflict on attempt ${attempt + 1}, retrying...`);
        
        // Exponential backoff: 100ms, 200ms, 400ms...
        if (attempt < maxRetries - 1) {
          const delay = 100 * Math.pow(2, attempt);
          Utilities.sleep(delay);
          continue;
        }
      }
      
      // Other error - don't retry
      return {
        success: false,
        error: updateResult.error,
        attempts: attempt + 1
      };
      
    } catch (err) {
      console.error(`Error on attempt ${attempt + 1}:`, err);
      if (attempt === maxRetries - 1) {
        return {
          success: false,
          error: err.message,
          attempts: attempt + 1
        };
      }
    }
  }
  
  return {
    success: false,
    error: 'Max retries exceeded',
    attempts: maxRetries
  };
}

function example2_RetryPattern() {
  const db = setupDatabaseWithVersioning();
  
  // Create a product
  const createResult = db.create(
    'PRODUCTS',
    { name: 'Mouse', price: 29.99, stock: 100, category: 'Electronics' },
    ['name', 'price', 'stock', 'category']
  );
  
  const productId = createResult.id;
  
  // Update with automatic retry
  const result = updateWithRetry(
    db,
    'PRODUCTS',
    productId,
    (product) => ({
      name: product.name,
      price: product.price,
      stock: product.stock - 1, // Decrement stock
      category: product.category
    }),
    ['name', 'price', 'stock', 'category'],
    5 // Max 5 retries
  );
  
  if (result.success) {
    console.log(`Stock updated successfully after ${result.attempts} attempt(s)`);
    console.log('New version:', result.data.version);
  } else {
    console.error(`Failed to update: ${result.error}`);
  }
}

// ============================================================================
// EXAMPLE 3: Inventory Management with Conflict Resolution
// ============================================================================

/**
 * Safely decrement stock with optimistic locking
 */
function decrementStock(db, productId, quantity) {
  const MAX_RETRIES = 5;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Read current stock
    const readResult = db.read('PRODUCTS', productId);
    
    if (readResult.status !== 200) {
      return {
        success: false,
        error: 'Product not found',
        code: 'NOT_FOUND'
      };
    }
    
    const product = readResult.data;
    const currentVersion = product.version;
    
    // Check if enough stock
    if (product.stock < quantity) {
      return {
        success: false,
        error: `Insufficient stock. Available: ${product.stock}, Requested: ${quantity}`,
        code: 'INSUFFICIENT_STOCK',
        availableStock: product.stock
      };
    }
    
    // Calculate new stock
    const updatedProduct = {
      name: product.name,
      price: product.price,
      stock: product.stock - quantity,
      category: product.category
    };
    
    // Attempt update with version check
    const updateResult = db.update(
      'PRODUCTS',
      productId,
      updatedProduct,
      ['name', 'price', 'stock', 'category'],
      false,
      null,
      currentVersion
    );
    
    // Success!
    if (updateResult.status === 200) {
      return {
        success: true,
        newStock: updatedProduct.stock,
        version: updateResult.version,
        attempts: attempt + 1
      };
    }
    
    // Conflict - retry
    if (updateResult.error && updateResult.error.includes('Optimistic concurrency conflict')) {
      console.log(`Stock update conflict, retry ${attempt + 1}/${MAX_RETRIES}`);
      
      // Exponential backoff
      if (attempt < MAX_RETRIES - 1) {
        Utilities.sleep(100 * Math.pow(2, attempt));
        continue;
      }
    }
    
    // Other error
    return {
      success: false,
      error: updateResult.error,
      code: 'UPDATE_FAILED'
    };
  }
  
  return {
    success: false,
    error: 'Too many conflicts, please try again',
    code: 'MAX_RETRIES_EXCEEDED'
  };
}

function example3_InventoryManagement() {
  const db = setupDatabaseWithVersioning();
  
  // Create a product with stock
  const createResult = db.create(
    'PRODUCTS',
    { name: 'Keyboard', price: 79.99, stock: 50, category: 'Electronics' },
    ['name', 'price', 'stock', 'category']
  );
  
  const productId = createResult.id;
  
  // Simulate multiple concurrent orders
  console.log('Processing concurrent orders...');
  
  // Order 1: Buy 5 units
  const order1 = decrementStock(db, productId, 5);
  console.log('Order 1:', order1);
  
  // Order 2: Buy 3 units (might conflict with Order 1)
  const order2 = decrementStock(db, productId, 3);
  console.log('Order 2:', order2);
  
  // Order 3: Try to buy 100 units (should fail - insufficient stock)
  const order3 = decrementStock(db, productId, 100);
  console.log('Order 3:', order3);
  
  // Check final stock
  const finalResult = db.read('PRODUCTS', productId);
  console.log('Final stock:', finalResult.data.stock);
  console.log('Final version:', finalResult.data.version);
}

// ============================================================================
// EXAMPLE 4: Order Processing with Atomic Stock Updates
// ============================================================================

/**
 * Process an order with atomic stock updates
 */
function processOrder(db, customerId, productId, quantity) {
  // Start by decrementing stock
  const stockResult = decrementStock(db, productId, quantity);
  
  if (!stockResult.success) {
    return {
      success: false,
      error: stockResult.error,
      code: stockResult.code
    };
  }
  
  // Get product details for order
  const productResult = db.read('PRODUCTS', productId);
  const product = productResult.data;
  
  // Create order record
  const orderResult = db.create(
    'ORDERS',
    {
      customer_name: `Customer ${customerId}`,
      product_id: productId,
      quantity: quantity,
      total: product.price * quantity,
      status: 'pending'
    },
    ['customer_name', 'product_id', 'quantity', 'total', 'status']
  );
  
  if (orderResult.status === 200) {
    return {
      success: true,
      orderId: orderResult.id,
      orderVersion: orderResult.version,
      productVersion: stockResult.version,
      total: product.price * quantity,
      message: `Order created successfully. Stock updated to ${stockResult.newStock}`
    };
  } else {
    // Order creation failed - need to rollback stock
    // (In production, you'd want proper transaction handling)
    console.error('Order creation failed, stock was decremented but order not created');
    return {
      success: false,
      error: 'Failed to create order',
      code: 'ORDER_CREATION_FAILED'
    };
  }
}

function example4_OrderProcessing() {
  const db = setupDatabaseWithVersioning();
  
  // Create a product
  const productResult = db.create(
    'PRODUCTS',
    { name: 'Monitor', price: 299.99, stock: 20, category: 'Electronics' },
    ['name', 'price', 'stock', 'category']
  );
  
  const productId = productResult.id;
  
  // Process multiple orders
  console.log('Processing orders...\n');
  
  const order1 = processOrder(db, 'CUST001', productId, 2);
  console.log('Order 1:', order1);
  
  const order2 = processOrder(db, 'CUST002', productId, 3);
  console.log('Order 2:', order2);
  
  const order3 = processOrder(db, 'CUST003', productId, 1);
  console.log('Order 3:', order3);
  
  // Check final state
  const finalProduct = db.read('PRODUCTS', productId);
  console.log('\nFinal product state:');
  console.log('Stock:', finalProduct.data.stock);
  console.log('Version:', finalProduct.data.version);
  
  const allOrders = db.getAll('ORDERS', { page: 1, pageSize: 100 });
  console.log('\nTotal orders created:', allOrders.data.length);
}

// ============================================================================
// EXAMPLE 5: Merge Strategy for Non-Conflicting Changes
// ============================================================================

/**
 * Intelligently merge changes when possible
 */
function mergeUpdate(db, tableName, id, changes, keyOrder) {
  // Read original data
  const originalResult = db.read(tableName, id);
  if (originalResult.status !== 200) {
    return originalResult;
  }
  
  const originalData = originalResult.data;
  const originalVersion = originalData.version;
  
  // Prepare merged data
  const mergedData = {};
  for (const key of keyOrder) {
    mergedData[key] = changes[key] !== undefined ? changes[key] : originalData[key];
  }
  
  // Attempt update
  const updateResult = db.update(
    tableName,
    id,
    mergedData,
    keyOrder,
    false,
    null,
    originalVersion
  );
  
  // If no conflict, we're done
  if (updateResult.status === 200) {
    return {
      success: true,
      data: updateResult,
      merged: false
    };
  }
  
  // If conflict, try to merge
  if (updateResult.error && updateResult.error.includes('Optimistic concurrency conflict')) {
    console.log('Conflict detected, attempting merge...');
    
    // Re-read current data
    const currentResult = db.read(tableName, id);
    const currentData = currentResult.data;
    const currentVersion = currentData.version;
    
    // Build final merged data
    const finalData = {};
    let hasConflict = false;
    
    for (const key of keyOrder) {
      // If we wanted to change this field
      if (changes[key] !== undefined) {
        // Check if someone else also changed it
        if (originalData[key] !== currentData[key]) {
          // Both changed the same field - real conflict
          console.log(`Conflict on field '${key}': original=${originalData[key]}, current=${currentData[key]}, wanted=${changes[key]}`);
          hasConflict = true;
          // Use current value (last-write-wins)
          finalData[key] = currentData[key];
        } else {
          // Field wasn't changed by others, use our change
          finalData[key] = changes[key];
        }
      } else {
        // We didn't want to change this field, use current value
        finalData[key] = currentData[key];
      }
    }
    
    // Retry with merged data
    const retryResult = db.update(
      tableName,
      id,
      finalData,
      keyOrder,
      false,
      null,
      currentVersion
    );
    
    return {
      success: retryResult.status === 200,
      data: retryResult,
      merged: true,
      hadConflicts: hasConflict
    };
  }
  
  // Other error
  return {
    success: false,
    error: updateResult.error
  };
}

function example5_MergeStrategy() {
  const db = setupDatabaseWithVersioning();
  
  // Create a product
  const createResult = db.create(
    'PRODUCTS',
    { name: 'Headphones', price: 149.99, stock: 30, category: 'Audio' },
    ['name', 'price', 'stock', 'category']
  );
  
  const productId = createResult.id;
  
  // Simulate two users making different changes
  console.log('User 1 wants to change price...');
  console.log('User 2 wants to change category...');
  
  // User 1 changes price
  const user1Changes = { price: 129.99 };
  const user1Result = mergeUpdate(
    db,
    'PRODUCTS',
    productId,
    user1Changes,
    ['name', 'price', 'stock', 'category']
  );
  console.log('User 1 result:', user1Result);
  
  // User 2 changes category (based on original data, will conflict)
  const user2Changes = { category: 'Electronics' };
  const user2Result = mergeUpdate(
    db,
    'PRODUCTS',
    productId,
    user2Changes,
    ['name', 'price', 'stock', 'category']
  );
  console.log('User 2 result:', user2Result);
  
  // Check final state
  const finalResult = db.read('PRODUCTS', productId);
  console.log('\nFinal product state:');
  console.log('Price:', finalResult.data.price); // Should be 129.99 (User 1)
  console.log('Category:', finalResult.data.category); // Should be 'Electronics' (User 2)
  console.log('Version:', finalResult.data.version);
}

// ============================================================================
// EXAMPLE 6: Monitoring and Metrics
// ============================================================================

/**
 * Track conflict rates for monitoring
 */
function updateWithMetrics(db, tableName, id, data, keyOrder, expectedVersion) {
  const startTime = new Date().getTime();
  
  const result = db.update(
    tableName,
    id,
    data,
    keyOrder,
    false,
    null,
    expectedVersion
  );
  
  const endTime = new Date().getTime();
  const duration = endTime - startTime;
  
  // Log metrics
  const metrics = {
    table: tableName,
    id: id,
    duration: duration,
    success: result.status === 200,
    conflict: result.error && result.error.includes('Optimistic concurrency conflict'),
    timestamp: new Date()
  };
  
  // In production, you'd send this to a monitoring system
  console.log('Update metrics:', metrics);
  
  // Could also write to a metrics sheet
  // writeMetricsToSheet(metrics);
  
  return result;
}

function example6_Monitoring() {
  const db = setupDatabaseWithVersioning();
  
  // Create a product
  const createResult = db.create(
    'PRODUCTS',
    { name: 'Webcam', price: 89.99, stock: 15, category: 'Electronics' },
    ['name', 'price', 'stock', 'category']
  );
  
  const productId = createResult.id;
  
  // Perform monitored updates
  const readResult = db.read('PRODUCTS', productId);
  const product = readResult.data;
  
  // Update with metrics
  const result1 = updateWithMetrics(
    db,
    'PRODUCTS',
    productId,
    { name: product.name, price: 79.99, stock: product.stock, category: product.category },
    ['name', 'price', 'stock', 'category'],
    product.version
  );
  
  // Try with old version (will conflict)
  const result2 = updateWithMetrics(
    db,
    'PRODUCTS',
    productId,
    { name: product.name, price: 69.99, stock: product.stock, category: product.category },
    ['name', 'price', 'stock', 'category'],
    product.version // Old version
  );
}

// ============================================================================
// EXAMPLE 7: Migration Helper for Existing Tables
// ============================================================================

/**
 * Add versioning to an existing table
 */
function addVersioningToExistingTable(tableName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(tableName);
  
  if (!sheet) {
    console.error(`Table ${tableName} not found`);
    return false;
  }
  
  // Check if VERSION column already exists
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.includes('VERSION')) {
    console.log('VERSION column already exists');
    return false;
  }
  
  // Insert VERSION column after DATE (column 2)
  sheet.insertColumnAfter(2);
  sheet.getRange(1, 3).setValue('VERSION');
  
  // Initialize all existing records to version 1
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const versionData = Array(lastRow - 1).fill([1]);
    sheet.getRange(2, 3, lastRow - 1, 1).setValues(versionData);
  }
  
  console.log(`Added versioning to ${tableName}, initialized ${lastRow - 1} records`);
  return true;
}

function example7_Migration() {
  // Add versioning to existing tables
  addVersioningToExistingTable('PRODUCTS');
  addVersioningToExistingTable('ORDERS');
  
  // Update schema context
  const db = new DB('My Database', 'YOUR_SPREADSHEET_ID');
  
  db.putTableIntoDbContext({
    tableName: 'PRODUCTS',
    enableVersioning: true,
    fields: {
      name: 'string',
      price: 'number',
      stock: 'number',
      category: 'string'
    }
  });
  
  console.log('Migration complete!');
}

// ============================================================================
// RUN EXAMPLES
// ============================================================================

function runAllExamples() {
  console.log('=== Example 1: Basic Version Check ===');
  example1_BasicVersionCheck();
  
  console.log('\n=== Example 2: Retry Pattern ===');
  example2_RetryPattern();
  
  console.log('\n=== Example 3: Inventory Management ===');
  example3_InventoryManagement();
  
  console.log('\n=== Example 4: Order Processing ===');
  example4_OrderProcessing();
  
  console.log('\n=== Example 5: Merge Strategy ===');
  example5_MergeStrategy();
  
  console.log('\n=== Example 6: Monitoring ===');
  example6_Monitoring();
}

// Uncomment to run individual examples:
// example1_BasicVersionCheck();
// example2_RetryPattern();
// example3_InventoryManagement();
// example4_OrderProcessing();
// example5_MergeStrategy();
// example6_Monitoring();
// example7_Migration();
