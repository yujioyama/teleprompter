using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using SQLDEMOAPP.Web.Models;
using SQLDEMOAPP.Web.Data;

namespace SQLDEMOAPP.Web.Controllers;

public class HomeController : Controller
{
    private readonly ILogger<HomeController> _logger;
    private readonly ApplicationDbContext _context;

    public HomeController(ILogger<HomeController> logger, ApplicationDbContext context)
    {
        _logger = logger;
        _context = context;
    }

    public IActionResult Index(string searchTerm)
    {
        {
            var users = _context.Users.AsQueryable();

            if (!string.IsNullOrEmpty(searchTerm))
            {
                users = users.Where(u => u.Name.Contains(searchTerm));
            }

            return View(users.ToList());
        }
    }

    public IActionResult Privacy()
    {
        return View();
    }

    [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
    public IActionResult Error()
    {
        return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
    }

    [HttpPost]
    public IActionResult Delete(int id)
    {
        var user = _context.Users.FirstOrDefault(u => u.Id == id);
        if (user != null)
        {
            _context.Users.Remove(user);
            _context.SaveChanges();
        }
        return RedirectToAction("Index");
    }

    // 新規ユーザー追加フォームを表示
    public IActionResult AddUser()
    {
        return View();
    }

    // ユーザー追加の処理
    [HttpPost]
    public IActionResult AddUser(string name, int age)
    {
        var user = new User { Name = name, Age = age };
        _context.Users.Add(user);
        _context.SaveChanges();

        return RedirectToAction("Index");
    }

    public IActionResult Edit(int id)
    {
        var user = _context.Users.FirstOrDefault(u=>u.Id == id);
        if (user == null)
        {
            return NotFound();
        }
        return View(user);
    }

    [HttpPost]
    public IActionResult Edit(User updatedUser)
    {
        var user = _context.Users.FirstOrDefault(u => u.Id == updatedUser.Id);
        if (user == null)
        {
            return NotFound();
        }
        
        user.Name = updatedUser.Name;
        user.Age = updatedUser.Age;

        _context.SaveChanges();
        return RedirectToAction("Index");
    }
}
