const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const SECRET_KEY = 'your_secret_key';

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/food%26Feast', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => {
    console.log('Connected to MongoDB');
}).catch((err) => {
    console.error('MongoDB connection error:', err);
});

// Models
const recipeSchema = new mongoose.Schema({}, { collection: 'recipes', strict: false });
const Recipe = mongoose.model('Recipe', recipeSchema);

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    phone: String,
    alternateEmail: String,
    address: String,
    name: String,
    age: Number
}, { collection: 'login' });

const User = mongoose.model('User', userSchema);

// Middleware to verify JWT token
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ success: false, message: 'No token provided' });

    const token = authHeader.split(' ')[1];
    if (!token) return res.status(403).json({ success: false, message: 'Invalid token format' });

    jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err) return res.status(401).json({ success: false, message: 'Token is invalid' });
        req.user = decoded;
        next();
    });
}

// User Registration
app.post('/api/register', async (req, res) => {
    const { email, password, phone, alternateEmail, address, name, age } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.json({ success: false, message: "User already exists" });
        }
        const newUser = new User({ email, password, phone, alternateEmail, address, name, age });
        await newUser.save();
        res.json({ success: true, message: "User registered successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error during registration' });
    }
});

// User Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || user.password !== password) {
            return res.json({ success: false, message: "Invalid credentials" });
        }
        const token = jwt.sign({ email: user.email }, SECRET_KEY, { expiresIn: '2h' });
        res.json({ success: true, message: "Login successful", token });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Login error' });
    }
});

// Create Recipe
app.post('/api/createRecipe', verifyToken, async (req, res) => {
    const { title, ingredients, nutrition, instructions } = req.body;
    if (!title || !ingredients || !nutrition || !instructions) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    try {
        const newRecipe = new Recipe({
            name: title,
            ingredients,
            nutrition,
            instructions,
            createdBy: req.user.email,
        });
        await newRecipe.save();
        res.json({ success: true, message: 'Recipe created successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error saving recipe' });
    }
});

// Get User's Recipes
app.get('/api/my-recipes', verifyToken, async (req, res) => {
    try {
        const recipes = await Recipe.find({ createdBy: req.user.email });
        res.json(recipes);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching recipes' });
    }
});

// Get Single Recipe by ID
app.get('/api/recipes/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    try {
        const recipe = await Recipe.findById(id);
        if (!recipe || recipe.createdBy !== req.user.email) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        res.json(recipe);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching recipe' });
    }
});

// Update Recipe by Deleting the Old and Creating a New One
app.put('/api/recipes/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const { title, ingredients, nutrition, instructions } = req.body;

    if (!title || !ingredients || !nutrition || !instructions) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid recipe ID' });
    }

    try {
        const recipe = await Recipe.findById(id);
        if (!recipe) {
            return res.status(404).json({ success: false, message: 'Recipe not found' });
        }

        // Check if the user is allowed to update the recipe
        if (String(recipe.createdBy).toLowerCase() !== req.user.email.toLowerCase()) {
            return res.status(403).json({ success: false, message: 'Not allowed to edit this recipe' });
        }

        // Delete the old recipe
        await Recipe.findByIdAndDelete(id);

        // Create a new recipe with updated data
        const newRecipe = new Recipe({
            name: title,
            ingredients,
            nutrition,
            instructions,
            createdBy: req.user.email,
        });

        await newRecipe.save();

        res.json({ success: true, message: 'Recipe updated successfully' });
    } catch (error) {
        console.error(error); // Log the error for debugging
        res.status(500).json({ success: false, message: 'Error updating recipe' });
    }
});

// 🔥 NEW: Delete Recipe by ID
app.delete('/api/recipes/:id', verifyToken, async (req, res) => {
    const { id } = req.params;

    try {
        const recipe = await Recipe.findById(id);
        if (!recipe || recipe.createdBy !== req.user.email) {
            return res.status(403).json({ success: false, message: 'Not allowed to delete this recipe' });
        }

        await Recipe.findByIdAndDelete(id);
        res.json({ success: true, message: 'Recipe deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error deleting recipe' });
    }
});

// Search Recipes
app.post('/api/search', async (req, res) => {
    const { ingredient, calorie, protein } = req.body;
    const query = {};

    if (ingredient) {
        query.ingredients = { $elemMatch: { $regex: ingredient, $options: 'i' } };
    }

    if (calorie) {
        if (calorie.includes('+')) {
            const min = parseInt(calorie.replace('+', ''));
            query['nutrition.0'] = { $gte: min };
        } else {
            const [min, max] = calorie.split('-').map(Number);
            query['nutrition.0'] = { $gte: min, $lte: max };
        }
    }

    if (protein) {
        if (protein.includes('+')) {
            const min = parseInt(protein.replace('+', ''));
            query['nutrition.4'] = { $gte: min };
        } else {
            const [min, max] = protein.split('-').map(Number);
            query['nutrition.4'] = { $gte: min, $lte: max };
        }
    }

    try {
        const recipes = await Recipe.find(query).limit(20);
        const mappedRecipes = recipes.map(r => ({
            _id: r._id,
            title: r.name,
            calories: r.nutrition ? r.nutrition[0] : 'N/A',
            protein: r.nutrition ? r.nutrition[4] : 'N/A',
            ingredients: r.ingredients || [],
        }));
        res.json(mappedRecipes);
    } catch (error) {
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// Reset password route
app.post('/api/reset-password', async (req, res) => {
    const { email, phone, newPassword } = req.body;
  
    try {
      const user = await User.findOne({ email });
  
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
  
      if (user.phone !== phone) {
        return res.status(400).json({ success: false, message: 'Phone number does not match' });
      }
  
      // You should hash the password in production
      user.password = newPassword;
      await user.save();
  
      res.json({ success: true, message: 'Password updated successfully' });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ success: false, message: 'Server error' });
    }
  });
  


// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});