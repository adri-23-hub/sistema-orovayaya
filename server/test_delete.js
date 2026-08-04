
async function testDelete() {
  const loginRes = await fetch("http://localhost:3000/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@orvayaya.com", password: "admin123" }) // Ensure using local DB
  });
  const loginData = await loginRes.json();
  
  if (!loginData.token) {
    console.log("Login failed:", loginData);
    return;
  }
  
  const token = loginData.token;
  
  const prodRes = await fetch("http://localhost:3000/v1/products?limit=1", {
    headers: { "Authorization": `Bearer ${token}` }
  });
  const prodData = await prodRes.json();
  
  if (!prodData.items || prodData.items.length === 0) {
    console.log("No products found.");
    return;
  }
  
  const productId = prodData.items[0].id;
  console.log("Attempting to delete product:", productId);
  
  const delRes = await fetch(`http://localhost:3000/v1/products/${productId}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${token}` }
  });
  
  const delData = await delRes.text();
  console.log("Delete status:", delRes.status);
  console.log("Delete response:", delData);
}

testDelete().catch(console.error);
