namespace SQLDEMOAPP.Web.Models
{
    public class User
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
        public int Age { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.Now;
    }
}